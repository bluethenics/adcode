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

/* ── Linking an account ─────────────────────────────────────────────────── */

const linkOk = (over: Record<string, unknown> = {}) => ({
  json: {
    idToken: "id-linked",
    refreshToken: "refresh-linked",
    localId: "uid-1",
    expiresIn: "3600",
    email: "dev@example.com",
    displayName: "A Developer",
    photoUrl: "https://lh3.googleusercontent.com/a/photo",
    providerUserInfo: [{ providerId: "google.com" }],
    ...over,
  },
});

describe("linking", () => {
  it("keeps the same uid, so earnings carry over", async () => {
    const { auth } = build([signUpOk(), linkOk()]);
    await auth.getToken();

    const linked = await auth.linkGoogle("google-id-token");

    expect(linked.ok).toBe(true);
    expect(auth.uid()).toBe("uid-1");
  });

  /*
   * The 200 that is not a link.
   *
   * `returnIdpCredential` makes the endpoint answer "that email already belongs to another
   * sign-in method" with a success status, `needConfirmation`, and no tokens. It reached
   * the user as "malformed link response" - a sentence about this client's parsing, for a
   * situation only the person signing in can resolve.
   */
  it("explains an email that already signs in another way", async () => {
    const { auth } = build([signUpOk(), { json: { needConfirmation: true } }]);
    await auth.getToken();

    const linked = await auth.linkGoogle("google-id-token");

    expect(linked.ok).toBe(false);
    if (linked.ok) throw new Error("expected a refusal");
    expect(linked.error.detail).toContain("already signs in a different way");
  });

  it("names the fields a malformed response was missing", async () => {
    const { auth } = build([signUpOk(), { json: { idToken: "only-this" } }]);
    await auth.getToken();

    const linked = await auth.linkGoogle("google-id-token");

    if (linked.ok) throw new Error("expected a refusal");
    expect(linked.error.detail).toContain("refreshToken");
    expect(linked.error.detail).toContain("localId");
  });

  it("keeps the uid it already had when a link is refused", async () => {
    const { auth } = build([signUpOk(), { json: { needConfirmation: true } }]);
    await auth.getToken();

    await auth.linkGoogle("google-id-token");

    expect(auth.uid()).toBe("uid-1");
  });

  it("returns the profile the provider gave", async () => {
    const { auth } = build([signUpOk(), linkOk()]);
    await auth.getToken();

    const linked = await auth.linkGoogle("google-id-token");
    if (!linked.ok) throw new Error("expected a link");

    expect(linked.value).toEqual({
      email: "dev@example.com",
      displayName: "A Developer",
      photoUrl: "https://lh3.googleusercontent.com/a/photo",
      providers: ["google.com"],
    });
  });

  it("sends a Google credential as an id_token", async () => {
    const { http, auth } = build([signUpOk(), linkOk()]);
    await auth.getToken();
    await auth.linkGoogle("google-id-token");

    const call = http.calls[1]!;
    expect(call.url).toContain("accounts:signInWithIdp");
    expect(String(call.body)).toContain("id_token=google-id-token");
    expect(String(call.body)).toContain("providerId=google.com");
  });

  it("sends a GitHub credential as an access_token", async () => {
    const { http, auth } = build([
      signUpOk(),
      linkOk({ providerUserInfo: [{ providerId: "github.com" }], photoUrl: "https://avatars.githubusercontent.com/u/1" }),
    ]);
    await auth.getToken();
    await auth.linkGitHub("gho_token");

    const call = http.calls[1]!;
    expect(String(call.body)).toContain("access_token=gho_token");
    expect(String(call.body)).toContain("providerId=github.com");
  });

  it("links an email and password through accounts:update", async () => {
    const { http, auth } = build([
      signUpOk(),
      linkOk({ providerUserInfo: [{ providerId: "password" }], photoUrl: undefined }),
    ]);
    await auth.getToken();

    const linked = await auth.linkPassword("dev@example.com", "hunter2hunter2");
    expect(linked.ok).toBe(true);

    const call = http.calls[1]!;
    expect(call.url).toContain("accounts:update");
    expect(String(call.body)).toContain("hunter2hunter2");
  });

  it("adopts the rotated refresh token, so a restart stays signed in", async () => {
    const { store, auth } = build([signUpOk(), linkOk()]);
    await auth.getToken();
    await auth.linkGoogle("google-id-token");

    const saved = JSON.parse(new TextDecoder().decode((await store.read("ads/identity.json"))!));
    expect(saved.refreshToken).toBe("refresh-linked");
    expect(saved.uid).toBe("uid-1");
  });

  it("REFUSES a link that would move the uid, rather than stranding the balance", async () => {
    // Firebase does this when the provider account already belongs to another user.
    const { auth } = build([signUpOk(), linkOk({ localId: "uid-someone-else" })]);
    await auth.getToken();

    const linked = await auth.linkGoogle("google-id-token");

    expect(linked.ok).toBe(false);
    if (linked.ok) return;
    expect(linked.error.detail).toMatch(/already in use/i);
    // The anonymous identity survives, so the earnings are still reachable.
    expect(auth.uid()).toBe("uid-1");
  });

  it("reports a provider refusal rather than throwing", async () => {
    const { auth } = build([signUpOk(), { status: 400, json: { error: { message: "CREDENTIAL_TOO_OLD_LOGIN_AGAIN" } } }]);
    await auth.getToken();

    const linked = await auth.linkGoogle("stale");
    expect(linked.ok).toBe(false);
  });
});

describe("profile", () => {
  it("reports null while the account is still anonymous", async () => {
    const { auth } = build([signUpOk(), { json: { users: [{ localId: "uid-1" }] } }]);
    await auth.getToken();

    const profile = await auth.profile();
    expect(profile).toEqual({ ok: true, value: null });
  });

  it("reports the linked identity once there is one", async () => {
    const { auth } = build([
      signUpOk(),
      {
        json: {
          users: [
            {
              localId: "uid-1",
              email: "dev@example.com",
              displayName: "A Developer",
              photoUrl: "https://lh3.googleusercontent.com/a/photo",
              providerUserInfo: [{ providerId: "google.com" }],
            },
          ],
        },
      },
    ]);
    await auth.getToken();

    const profile = await auth.profile();
    if (!profile.ok || profile.value === null) throw new Error("expected a profile");
    expect(profile.value.email).toBe("dev@example.com");
    expect(profile.value.photoUrl).toContain("googleusercontent");
  });

  it("survives a provider that returns no picture", async () => {
    const { auth } = build([
      signUpOk(),
      { json: { users: [{ localId: "uid-1", email: "d@e.com", providerUserInfo: [{ providerId: "github.com" }] }] } },
    ]);
    await auth.getToken();

    const profile = await auth.profile();
    if (!profile.ok || profile.value === null) throw new Error("expected a profile");
    expect(profile.value.photoUrl).toBeNull();
  });
});
