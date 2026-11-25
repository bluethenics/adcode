import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "../src/components/AuthContext";

/**
 * The admin gate has two different refusals to tell apart.
 *
 * "Not an admin account" is an answer. An API that did not answer is not, and reading
 * the failure as `isAdmin: false` told the founding administrator she was not one while
 * every admin endpoint would still have accepted her. These render the real `AdminShell`
 * with a stubbed auth state, so the copy and the retry are checked where they are used.
 */

const auth = vi.hoisted(() => ({ current: {} as AuthState }));

vi.mock("../src/components/AuthProvider", () => ({
  useAuth: () => auth.current,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: () => undefined }),
}));

const { AdminShell } = await import("../src/components/AdminShell");

const signedIn = {
  uid: "preview",
  email: "bluethenics01@gmail.com",
  emailVerified: true,
} as unknown as AuthState["user"];

function setAuth(overrides: Partial<AuthState>): void {
  auth.current = {
    user: signedIn,
    loading: false,
    configured: true,
    token: async () => null,
    isAdmin: false,
    adminLoading: false,
    adminError: null,
    retryAdmin: () => undefined,
    banned: false,
    ...overrides,
  };
}

const render = (): string =>
  renderToStaticMarkup(
    <AdminShell title="Overview" subtitle="Every queue, at a glance">
      <p>Admin content</p>
    </AdminShell>,
  );

describe("the admin gate", () => {
  beforeEach(() => setAuth({}));

  it("shows a banned account the banned page, never the panel, with a way to appeal", () => {
    setAuth({ banned: true, isAdmin: true });
    const markup = render();
    expect(markup).toContain("This account has been banned");
    expect(markup).toContain("mailto:adcode.support@gmail.com");
    expect(markup).toContain("Check again");
    expect(markup).not.toContain("Admin content");
  });

  it("offers a retry when the server could not answer, rather than calling the account a non-admin", () => {
    setAuth({ adminError: "server-error" });
    const markup = render();

    expect(markup).toContain("Couldn&#x27;t check your access");
    expect(markup).toContain("bluethenics01@gmail.com");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("Not an admin account");
  });

  it("says the request never left the browser when the network failed", () => {
    setAuth({ adminError: "offline" });
    expect(render()).toContain("The request never reached it");
  });

  it("still refuses a real non-admin with the correct explanation", () => {
    setAuth({ adminError: null, isAdmin: false });
    const markup = render();

    expect(markup).toContain("Not an admin account");
    expect(markup).toContain("isn&#x27;t on the administrator list");
    expect(markup).not.toContain("Couldn&#x27;t check your access");
  });

  it("does not render the panel while the answer is still on its way", () => {
    setAuth({ adminLoading: true });
    expect(render()).toContain("Checking your access");
  });
});
