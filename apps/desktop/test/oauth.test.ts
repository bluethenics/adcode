import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env["ADCODE_GOOGLE_CLIENT_SECRET"] = "isolated-test-credential";
  return { openExternal: vi.fn() };
});
vi.mock("electron", () => ({ shell: { openExternal: mocks.openExternal } }));
import { cancelSignIn, linkWithGitHub, linkWithGoogle, openGitHubCompletionPage } from "../src/main/oauth.ts";

const realFetch = globalThis.fetch;
const request = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const device = (extra = {}) => json({ user_code: "TEST-CODE", device_code: "test-device", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900, ...extra });
beforeEach(() => {
  mocks.openExternal.mockReset().mockResolvedValue(undefined);
  request.mockReset();
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  cancelSignIn();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function googleCallback() {
  await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalled());
  const authorize = new URL(mocks.openExternal.mock.calls[0]![0] as string);
  const callback = new URL(authorize.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  callback.searchParams.set("code", "test-code");
  return { authorize, callback };
}

describe("Google browser sign-in", () => {
  it("waits for token exchange, ignores favicon requests, and prevents duplicate exchanges", async () => {
    let complete!: (response: Response) => void;
    request.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const flow = linkWithGoogle();
    const { authorize, callback } = await googleCallback();
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect((await realFetch(new URL("/favicon.ico", callback))).status).toBe(404);
    let received = false;
    const page = realFetch(callback).then(response => { received = true; return response; });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(received).toBe(false);
    expect((await realFetch(callback)).status).toBe(409);
    expect(request).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0]![1]!;
    expect((options.body as URLSearchParams).get("code_verifier")!.length).toBeGreaterThan(40);
    complete(json({ id_token: "test-identity" }));
    await expect(flow).resolves.toEqual({ ok: true, provider: "google.com", idToken: "test-identity" });
    const response = await page;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("You’re signed in");
    expect(html).toContain("done-icon");
    expect(html).not.toContain("test-identity");
    expect(cancelSignIn()).toBe(false);
  });
  it("shows an escaped failure page when Google rejects the exchange", async () => {
    request.mockResolvedValue(json({ error_description: "Expired <code>" }, 400));
    const flow = linkWithGoogle();
    const { callback } = await googleCallback();
    const response = await realFetch(callback);
    await expect(flow).resolves.toEqual({ ok: false, reason: "Google refused the sign-in: Expired <code>" });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("Expired &lt;code&gt;");
    expect(html).not.toContain("You’re signed in");
  });
  it("rejects a mismatched state even on a denial callback", async () => {
    const flow = linkWithGoogle();
    const { callback } = await googleCallback();
    callback.searchParams.set("state", "other-flow");
    callback.searchParams.set("error", "access_denied");
    expect((await realFetch(callback)).status).toBe(400);
    await expect(flow).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("could not be verified") });
    expect(request).not.toHaveBeenCalled();
  });
  it("cancels an exchange immediately and releases the sign-in lock", async () => {
    request.mockImplementation((_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
    const flow = linkWithGoogle();
    const { callback } = await googleCallback();
    const page = realFetch(callback);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await expect(linkWithGitHub(vi.fn())).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("Another sign-in") });
    expect(cancelSignIn()).toBe(true);
    await expect(flow).resolves.toEqual({ ok: false, reason: "Sign-in cancelled." });
    expect((await page).status).toBe(400);
    expect(cancelSignIn()).toBe(false);
  });
  it("reports a browser launch failure and accepts a retry", async () => {
    mocks.openExternal.mockRejectedValue(new Error("no browser"));
    await expect(linkWithGoogle()).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("open your browser") });
    expect(cancelSignIn()).toBe(false);
  });
});

describe("GitHub device sign-in", () => {
  beforeEach(() => vi.useFakeTimers());
  it("honors pending and slow_down polling intervals before accepting a token", async () => {
    request.mockResolvedValueOnce(device()).mockResolvedValueOnce(json({ error: "authorization_pending" })).mockResolvedValueOnce(json({ error: "slow_down" })).mockResolvedValueOnce(json({ access_token: "test-access" }));
    const onCode = vi.fn();
    const flow = linkWithGitHub(onCode);
    await vi.advanceTimersByTimeAsync(0);
    expect(onCode).toHaveBeenCalledWith({ userCode: "TEST-CODE", verificationUri: "https://github.com/login/device" });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await expect(flow).resolves.toEqual({ ok: true, provider: "github.com", accessToken: "test-access" });
    expect(cancelSignIn()).toBe(false);
  });
  it("can cancel while requesting the code, before opening a browser", async () => {
    request.mockImplementation((_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
    const onCode = vi.fn();
    const flow = linkWithGitHub(onCode);
    expect(cancelSignIn()).toBe(true);
    await expect(flow).resolves.toEqual({ ok: false, reason: "Sign-in cancelled." });
    expect(onCode).not.toHaveBeenCalled();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
  it("cancels the polling wait without waiting five seconds", async () => {
    request.mockResolvedValueOnce(device());
    const flow = linkWithGitHub(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelSignIn()).toBe(true);
    await expect(flow).resolves.toMatchObject({ ok: false, reason: "Sign-in cancelled." });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("honors a device code expiry shorter than the application timeout", async () => {
    request.mockResolvedValueOnce(device({ expires_in: 1 }));
    const flow = linkWithGitHub(vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(flow).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("timed out") });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["https://github.com.attacker.test/login/device", "http://github.com/login/device", "https://github.com/login/device?next=evil", "https://user:pass@github.com/login/device"])("rejects an unexpected verification address: %s", async uri => {
    request.mockResolvedValueOnce(device({ verification_uri: uri }));
    await expect(linkWithGitHub(vi.fn())).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("unexpected") });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
  it.each([
    [{ error: "access_denied" }, 200, "declined"],
    [{ error: "expired_token" }, 200, "expired"],
    [{ access_token: "" }, 200, "refused"],
    [{ access_token: "test-access" }, 400, "refused"],
  ])("handles a refused or unusable token (%j)", async (body, status, reason) => {
    request.mockResolvedValueOnce(device()).mockResolvedValueOnce(json(body, status as number));
    const flow = linkWithGitHub(vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(flow).resolves.toMatchObject({ ok: false, reason: expect.stringContaining(reason as string) });
  });
  it("reports a browser failure and releases the active flow", async () => {
    request.mockResolvedValueOnce(device());
    mocks.openExternal.mockRejectedValueOnce(new Error("no browser"));
    await expect(linkWithGitHub(vi.fn())).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("open your browser") });
    expect(cancelSignIn()).toBe(false);
  });
});

it("serves a branded, private GitHub completion page without credential data", async () => {
  let url = "";
  mocks.openExternal.mockImplementationOnce((address: string) => { url = address; return Promise.resolve(); });
  await openGitHubCompletionPage();
  expect(new URL(url).hostname).toBe("127.0.0.1");
  const response = await realFetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const html = await response.text();
  expect(html).toContain("Your GitHub account is connected");
  expect(html).toContain("done-icon");
  expect(html).not.toContain("test-access");
  expect((await realFetch(new URL("/favicon.ico", url))).status).toBe(404);
});
