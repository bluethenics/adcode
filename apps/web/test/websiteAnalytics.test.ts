import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });
function browser() {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("navigator", { doNotTrack: "0", userAgent: "Desktop" });
  vi.stubGlobal("document", { referrer: "https://search.test/results?private=true" });
  vi.stubGlobal("location", { pathname: "/", search: "?utm_source=newsletter&utm_campaign=launch&email=private", origin: "https://site.test" });
  vi.stubGlobal("localStorage", storage(local));
  vi.stubGlobal("sessionStorage", storage(session));
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, session };
}
describe("website event privacy and delivery", () => {
  it("does not send before consent and strips queries, identifiers, and admin paths", async () => {
    const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(fetcher).not.toHaveBeenCalled();
    analytics.setAnalyticsChoice("accepted");
    analytics.trackWebsiteEvent("page_view", 0, "/portal/campaigns/camp-private?token=secret");
    analytics.trackWebsiteEvent("page_view", 0, "/admin/money");
    analytics.flushWebsiteAnalytics();
    const request = fetcher.mock.calls[0]![1];
    expect(request.credentials).toBe("omit");
    expect(request.referrerPolicy).toBe("no-referrer");
    const events = JSON.parse(request.body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ path: "/portal/campaigns/detail", source: "newsletter", campaign: "launch" });
    expect(request.body).not.toContain("private");
    expect(request.body).not.toContain("secret");
  });
  it("clears queued events and session on decline, and honors privacy signals", async () => {
    const { fetcher, session } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view");
    analytics.setAnalyticsChoice("declined"); analytics.flushWebsiteAnalytics();
    expect(fetcher).not.toHaveBeenCalled(); expect(session.size).toBe(0);
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("batches events and rotates a session after inactivity", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view"); analytics.trackWebsiteEvent("install_copy");
    await vi.advanceTimersByTimeAsync(3000);
    const first = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(first).toHaveLength(2); expect(first[0].session).toBe(first[1].session);
    await vi.advanceTimersByTimeAsync(31 * 60000);
    analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)[0].session).not.toBe(first[0].session);
  });
});
