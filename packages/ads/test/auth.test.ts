import { describe, it, expect } from "vitest";
import { createFirebaseAuth, REFRESH_SKEW_MS } from "../src/auth.ts";
import { FakeClock, FakeFileStore, FakeHttpTransport } from "./fakes.ts";

const API_KEY = "test-api-key";

const signUpOk = (idToken = "id-1", refreshToken = "refresh-1", expiresIn = "3600") => ({
  json: { idToken, refreshToken, localId: "uid-1", expiresIn },
});

const refreshOk = (idToken = "id-2", refreshToken = "refresh-2", expiresIn = "3600") => ({
  json: { id_token: idToken, refresh_token: refreshToken, user_id: "uid-1", expires_in: expiresIn },
});

function build(responses: Parameters<FakeHttpTransport["push"]>[0][] = []) {
  const http = new FakeHttpTransport(responses);
  const clock = new FakeClock();
  const store = new FakeFileStore();
  const auth = createFirebaseAuth({ http, clock, store, apiKey: API_KEY });
  return { http, clock, store, auth };
}

describe("anonymous sign-up", () => {
  it("signs up once and reuses the cached token", async () => {
    const { http, auth } = build([signUpOk()]);

    const first = await auth.getToken();
    const second = await auth.getToken();

    expect(first).toEqual({ ok: true, value: "id-1" });
    expect(second).toEqual({ ok: true, value: "id-1" });
    expect(http.calls).toHaveLength(1);
  });

  it("calls the identitytoolkit signUp endpoint with returnSecureToken", async () => {
    const { http, auth } = build([signUpOk()]);
    await auth.getToken();

    const call = http.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toContain("identitytoolkit.googleapis.com/v1/accounts:signUp");
    expect(call.url).toContain(`key=${API_KEY}`);
    expect(JSON.parse(call.body ?? "{}")).toEqual({ returnSecureToken: true });
  });

  it("exposes the uid, since the ledger accrues against it", async () => {
    const { auth } = build([signUpOk()]);
    expect(auth.uid()).toBeNull();
    await auth.getToken();
    expect(auth.uid()).toBe("uid-1");
  });

  it("persists the refresh token so a restart does not create a second identity", async () => {
    // Brief §8.4: "A ledger cannot accrue against an identifier that rotates."
    const { http, clock, store, auth } = build([signUpOk()]);
    await auth.getToken();
    expect(http.calls).toHaveLength(1);

    const revived = createFirebaseAuth({
      http: new FakeHttpTransport([refreshOk()]),
      clock,
      store,
      apiKey: API_KEY,
    });
    await revived.load();

    expect(revived.uid()).toBe("uid-1");
  });
});

describe("token refresh", () => {
  it("refreshes before expiry, not at it", async () => {
    const { http, clock, auth } = build([signUpOk("id-1", "refresh-1", "3600"), refreshOk()]);
    await auth.getToken();

    // One millisecond before the skew window opens: still the original token.
    clock.advance(3_600_000 - REFRESH_SKEW_MS - 1);
    expect(await auth.getToken()).toEqual({ ok: true, value: "id-1" });
    expect(http.calls).toHaveLength(1);

    // Inside the skew window: refreshed ahead of expiry, so no request ever carries a
    // token that is about to die in flight.
    clock.advance(2);
    expect(await auth.getToken()).toEqual({ ok: true, value: "id-2" });
    expect(http.calls).toHaveLength(2);
  });

  it("uses the secure token endpoint with grant_type=refresh_token", async () => {
    const { http, clock, auth } = build([signUpOk(), refreshOk()]);
    await auth.getToken();
    clock.advance(3_600_000);
    await auth.getToken();

    const call = http.calls[1]!;
    expect(call.url).toContain("securetoken.googleapis.com/v1/token");
    expect(call.body).toContain("grant_type=refresh_token");
    expect(call.body).toContain("refresh_token=refresh-1");
  });

  it("re-signs-up if the refresh token is rejected", async () => {
    const { http, clock, auth } = build([
      signUpOk("id-1", "refresh-1"),
      { status: 400, json: { error: { message: "TOKEN_EXPIRED" } } },
      signUpOk("id-3", "refresh-3"),
    ]);
    await auth.getToken();
    clock.advance(3_600_000);

    expect(await auth.getToken()).toEqual({ ok: true, value: "id-3" });
    expect(http.calls).toHaveLength(3);
  });

  it("invalidate() forces a refresh on the next call", async () => {
    const { http, auth } = build([signUpOk(), refreshOk()]);
    await auth.getToken();
    auth.invalidate();

    expect(await auth.getToken()).toEqual({ ok: true, value: "id-2" });
    expect(http.calls).toHaveLength(2);
  });
});

describe("failure", () => {
  it("returns a typed error instead of throwing into the caller", async () => {
    // §9: an ad-side failure may never degrade anything. Throwing here would put an
    // ad concern on a code path the editor shares.
    const { auth } = build([{ status: 400, json: { error: { message: "ADMIN_ONLY_OPERATION" } } }]);

    const result = await auth.getToken();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.detail).toContain("ADMIN_ONLY_OPERATION");
    }
  });

  it("returns a typed error when the transport itself throws", async () => {
    const { auth } = build([{ throws: new Error("offline") }]);
    const result = await auth.getToken();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain("offline");
  });

  it("returns a typed error on a malformed sign-up response", async () => {
    const { auth } = build([{ json: { unexpected: true } }]);
    expect((await auth.getToken()).ok).toBe(false);
  });

  it("does not cache a failure - a later call can still succeed", async () => {
    const { auth } = build([{ throws: new Error("offline") }, signUpOk("id-9")]);

    expect((await auth.getToken()).ok).toBe(false);
    expect(await auth.getToken()).toEqual({ ok: true, value: "id-9" });
  });
});

describe("reset", () => {
  it("forfeits the identity, as the settings screen warns", async () => {
    // §8.4: "Let the user reset the identifier from settings, warning first that doing
    // so forfeits any unclaimed balance."
    const { store, auth } = build([signUpOk(), signUpOk("id-new", "refresh-new")]);
    await auth.getToken();

    await auth.reset();
    expect(auth.uid()).toBeNull();
    expect(store.files.size).toBe(0);

    expect(await auth.getToken()).toEqual({ ok: true, value: "id-new" });
  });
});
