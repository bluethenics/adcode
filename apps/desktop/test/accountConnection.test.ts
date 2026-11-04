import { beforeEach, expect, it, vi } from "vitest";
import { CHANNELS } from "../src/shared/api.ts";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  github: vi.fn(), google: vi.fn(), completion: vi.fn(),
  auth: { uid: () => "test-user", profile: vi.fn(), linkGitHub: vi.fn(), linkGoogle: vi.fn(), linkPassword: vi.fn(), signInPassword: vi.fn(), getToken: vi.fn(), signInGitHub: vi.fn() },
}));
vi.mock("electron", () => ({ app: { getPath: () => ".tmp/account-connection-test" }, ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../src/main/backend.ts", () => ({ backendAccount: () => mocks.auth, apiBaseUrl: () => "http://127.0.0.1" }));
vi.mock("../src/main/adPorts.ts", () => ({ DiskFileStore: class {}, FetchHttpTransport: class {}, SystemClock: class {} }));
vi.mock("../src/main/oauth.ts", () => ({ linkWithGitHub: mocks.github, linkWithGoogle: mocks.google, cancelSignIn: vi.fn(), openGitHubCompletionPage: mocks.completion }));
import { registerAccountIpc } from "../src/main/accountIpc.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.github.mockResolvedValue({ ok: true, provider: "github.com", accessToken: "test-access" });
  mocks.google.mockResolvedValue({ ok: true, provider: "google.com", idToken: "test-identity" });
  mocks.auth.linkGitHub.mockResolvedValue({ ok: true });
  mocks.auth.linkGoogle.mockResolvedValue({ ok: true });
  mocks.auth.profile.mockResolvedValue({ ok: true, value: { email: "test@example.com", displayName: "Test", photoUrl: null, providers: ["github.com"] } });
  mocks.auth.getToken.mockResolvedValue({ ok: false });
  mocks.auth.signInGitHub.mockResolvedValue({ ok: true });
  mocks.auth.linkPassword.mockResolvedValue({ ok: true });
  mocks.auth.signInPassword.mockResolvedValue({ ok: true });
  mocks.completion.mockResolvedValue(undefined);
  registerAccountIpc();
});
const link = (provider: string) => mocks.handlers.get(CHANNELS.accountLink)!(null, provider);
it("opens GitHub completion only after the account is linked", async () => {
  let complete!: (value: { ok: true }) => void;
  mocks.auth.linkGitHub.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = link("github");
  await vi.waitFor(() => expect(mocks.auth.linkGitHub).toHaveBeenCalled());
  expect(mocks.completion).not.toHaveBeenCalled();
  complete({ ok: true });
  await expect(pending).resolves.toMatchObject({ ok: true, state: { state: "linked" } });
  expect(mocks.completion).toHaveBeenCalledOnce();
});
it("does not show success when provider authorization or account linking fails", async () => {
  mocks.github.mockResolvedValueOnce({ ok: false, reason: "Declined" });
  await expect(link("github")).resolves.toEqual({ ok: false, message: "Declined" });
  mocks.auth.linkGitHub.mockResolvedValueOnce({ ok: false, error: { reason: "unavailable", detail: "Try again" } });
  await expect(link("github")).resolves.toEqual({ ok: false, message: "Try again" });
  expect(mocks.completion).not.toHaveBeenCalled();
});
it("waits for the existing-account choice before opening completion", async () => {
  mocks.auth.linkGitHub.mockResolvedValueOnce({ ok: false, error: { reason: "account-exists", detail: "Exists" } });
  await expect(link("github")).resolves.toMatchObject({ ok: false, decide: "sign-in-instead" });
  expect(mocks.completion).not.toHaveBeenCalled();
  await expect(mocks.handlers.get(CHANNELS.accountSignInInstead)!(null)).resolves.toMatchObject({ ok: true });
  expect(mocks.auth.signInGitHub).toHaveBeenCalledWith("test-access");
  expect(mocks.completion).toHaveBeenCalledOnce();
});
it("keeps Google's own callback page separate from GitHub completion", async () => {
  await expect(link("google")).resolves.toMatchObject({ ok: true });
  expect(mocks.auth.linkGoogle).toHaveBeenCalledWith("test-identity");
  expect(mocks.completion).not.toHaveBeenCalled();
});

const emailLink = (email: unknown, password: unknown) => mocks.handlers.get(CHANNELS.accountLinkEmail)!(null, email, password);
it("validates email sign-in and links a new email account", async () => {
  await expect(emailLink("invalid", "long-password")).resolves.toMatchObject({ ok: false });
  await expect(emailLink("test@example.com", "short")).resolves.toMatchObject({ ok: false });
  expect(mocks.auth.linkPassword).not.toHaveBeenCalled();
  await expect(emailLink(" test@example.com ", "long-password")).resolves.toMatchObject({ ok: true, state: { state: "linked" } });
  expect(mocks.auth.linkPassword).toHaveBeenCalledWith("test@example.com", "long-password");
});
it("signs into an existing email account after the explicit account-switch choice", async () => {
  mocks.auth.linkPassword.mockResolvedValueOnce({ ok: false, error: { reason: "account-exists", detail: "Exists" } });
  await expect(emailLink("test@example.com", "long-password")).resolves.toMatchObject({ ok: false, decide: "sign-in-instead" });
  expect(mocks.auth.signInPassword).not.toHaveBeenCalled();
  await expect(mocks.handlers.get(CHANNELS.accountSignInInstead)!(null)).resolves.toMatchObject({ ok: true });
  expect(mocks.auth.signInPassword).toHaveBeenCalledWith("test@example.com", "long-password");
});
