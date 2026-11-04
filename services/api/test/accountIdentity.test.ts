import { describe, expect, it, vi } from "vitest";
import { createFirebaseIdentity } from "../src/accountIdentity.ts";

describe("verification delivery diagnostics", () => {
  it("keeps the user's token in the request and exposes only a bounded error code", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "QUOTA_EXCEEDED : private diagnostic detail" } }), { status: 400 }));
    const identity = createFirebaseIdentity(() => "public-key", fetcher);
    expect(await identity.testVerification!("private-token")).toEqual({ sent: false, reason: "QUOTA_EXCEEDED" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ requestType: "VERIFY_EMAIL", idToken: "private-token" });
    expect(await identity.sendVerification("private-token")).toBe(false);
  });
  it("reports delivery, missing configuration and network failures accurately", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    expect(await createFirebaseIdentity(() => "key", fetcher).testVerification!("token")).toEqual({ sent: true, reason: null });
    fetcher.mockRejectedValue(new Error("private network detail"));
    expect(await createFirebaseIdentity(() => "key", fetcher).testVerification!("token")).toEqual({ sent: false, reason: "UNREACHABLE" });
    expect(await createFirebaseIdentity(() => "", fetcher).testVerification!("token")).toEqual({ sent: false, reason: "NOT_CONFIGURED" });
  });
});

describe("the account's address", () => {
  const lookup = (user: unknown) => createFirebaseIdentity(() => "key", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ users: [user] }))).lookup("token");
  it("uses the account's own email and its verified state", async () => {
    expect(await lookup({ email: "Dev@Example.com", emailVerified: true, providerUserInfo: [{ email: "other@example.com" }] })).toEqual({ email: "dev@example.com", emailVerified: true });
  });
  it("falls back to the sign-in provider's address, unverified, when the account has none", async () => {
    // Without it a GitHub sign-in with no top-level email had nowhere to receive a link.
    expect(await lookup({ emailVerified: true, providerUserInfo: [{ providerId: "github.com" }, { providerId: "github.com", email: "Gh@Example.com" }] })).toEqual({ email: "gh@example.com", emailVerified: false });
    expect(await lookup({ providerUserInfo: [{ providerId: "github.com" }] })).toEqual({ email: null, emailVerified: false });
  });
});
