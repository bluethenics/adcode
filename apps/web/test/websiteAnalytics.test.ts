import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });
function browser(navigatorFields: Record<string, unknown> = {}) {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("navigator", { doNotTrack: "0", userAgent: "Desktop", ...navigatorFields });
  vi.stubGlobal("document", { referrer: "https://search.test/results?private=true" });
  vi.stubGlobal("location", { pathname: "/", search: "?utm_source=newsletter&utm_campaign=launch&email=private", origin: "https://site.test" });
  vi.stubGlobal("localStorage", storage(local));
  vi.stubGlobal("sessionStorage", storage(session));
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, session, local };
}
type Sent = { id: string; session: string; name: string; path: string; source: string; campaign: string; value: number; age: number; placement?: string };
const sent = (fetcher: ReturnType<typeof vi.fn>, call: number): Sent[] => JSON.parse(fetcher.mock.calls[call]![1].body);

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
    const first = sent(fetcher, 0);
    expect(first).toHaveLength(2); expect(first[0]!.session).toBe(first[1]!.session);
    await vi.advanceTimersByTimeAsync(31 * 60000);
    analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(sent(fetcher, 1)[0]!.session).not.toBe(first[0]!.session);
  });
});

/* The audit of 2026-10-06, one case per finding. */
describe("what reaches the report", () => {
  it("starts a visit that resumes after half an hour with a page view, so its install still counts", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(31 * 60000);
    analytics.trackWebsiteEvent("install_copy", 0, undefined, "hero"); analytics.flushWebsiteAnalytics();
    const resumed = sent(fetcher, 1);
    expect(resumed.map((event) => event.name)).toEqual(["page_view", "install_copy"]);
    expect(resumed[0]!.session).toBe(resumed[1]!.session);
    expect(resumed[0]!.session).not.toBe(sent(fetcher, 0)[0]!.session);
  });
  it("keeps time already spent with the visit it measured, and a reader's visit alive", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view");
    await vi.advanceTimersByTimeAsync(3000);
    const visit = sent(fetcher, 0)[0]!.session;
    // Scrolling every twenty minutes: nothing recorded, but somebody is plainly there.
    await vi.advanceTimersByTimeAsync(20 * 60000); analytics.touchWebsiteSession();
    await vi.advanceTimersByTimeAsync(20 * 60000);
    analytics.trackWebsiteEvent("download_click"); analytics.flushWebsiteAnalytics();
    expect(sent(fetcher, 1).map((event) => [event.name, event.session])).toEqual([["download_click", visit]]);
    // Forty minutes of nothing, then the tab is hidden: the engaged time belongs to that visit.
    await vi.advanceTimersByTimeAsync(40 * 60000);
    analytics.trackWebsiteEvent("engagement", 60000); analytics.flushWebsiteAnalytics();
    expect(sent(fetcher, 2).map((event) => [event.name, event.session])).toEqual([["engagement", visit]]);
  });
  it("sends how long ago each event happened, so a batch keeps its order", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view");
    await vi.advanceTimersByTimeAsync(1000);
    analytics.trackWebsiteEvent("install_copy");
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent(fetcher, 0).map((event) => [event.name, event.age])).toEqual([["page_view", 3000], ["install_copy", 2000]]);
  });
  it("retries a failed delivery with the same events, and gives up on a refused one", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    fetcher.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce({ ok: false, status: 503 });
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new Set([0, 1, 2].map((call) => sent(fetcher, call)[0]!.id)).size).toBe(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetcher).toHaveBeenCalledTimes(3); // delivered on the third try; nothing left

    fetcher.mockResolvedValueOnce({ ok: false, status: 400 });
    analytics.trackWebsiteEvent("install_copy"); analytics.flushWebsiteAnalytics();
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetcher).toHaveBeenCalledTimes(4); // a malformed batch will not improve by resending it
  });
  it("sends again from the next page what the last one could not confirm", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    fetcher.mockImplementationOnce(() => new Promise(() => {})); // the page unloads mid-request
    let analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    const id = sent(fetcher, 0)[0]!.id;
    vi.resetModules();
    analytics = await import("../src/lib/websiteAnalytics");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent(fetcher, 1).map((event) => event.id)).toEqual([id]);
  });
  it("keeps where the visitor came from when they click around before answering the banner", async () => {
    const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    // Navigated inside the site: the tag is gone from the address bar.
    vi.stubGlobal("location", { pathname: "/docs", search: "", origin: "https://site.test" });
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(sent(fetcher, 0)[0]).toMatchObject({ path: "/docs", source: "newsletter", campaign: "launch" });
  });
  it("re-sends a Web Vital that changed under its first id, and nothing when it did not", async () => {
    const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted");
    analytics.trackWebsiteVital("CLS", 0.02, "/", "v4-cls-1"); analytics.flushWebsiteAnalytics();
    await Promise.resolve();
    analytics.trackWebsiteVital("CLS", 0.31, "/", "v4-cls-1"); analytics.flushWebsiteAnalytics();
    const [first] = sent(fetcher, 0), [later] = sent(fetcher, 1);
    expect(later).toMatchObject({ id: first!.id, name: "CLS", value: 0.31 });
    await Promise.resolve();
    analytics.trackWebsiteVital("CLS", 0.31, "/", "v4-cls-1"); analytics.flushWebsiteAnalytics();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("records an entry step once per visit, and again in the next visit", async () => {
    vi.useFakeTimers(); const { fetcher } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view");
    analytics.trackWebsiteEventOnce("form", "advertise_click"); analytics.trackWebsiteEventOnce("form", "advertise_click");
    analytics.flushWebsiteAnalytics();
    expect(sent(fetcher, 0).map((event) => event.name)).toEqual(["page_view", "advertise_click"]);
    await vi.advanceTimersByTimeAsync(31 * 60000);
    analytics.trackWebsiteEventOnce("form", "advertise_click"); analytics.flushWebsiteAnalytics();
    expect(sent(fetcher, 1).map((event) => event.name)).toEqual(["page_view", "advertise_click"]);
  });
  it("counts nothing from an automated browser", async () => {
    const { fetcher } = browser({ webdriver: true });
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted"); analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("leaves an administrator's browser out unless they chose to count it", async () => {
    const { fetcher, local } = browser();
    const analytics = await import("../src/lib/websiteAnalytics");
    analytics.setAnalyticsChoice("accepted");
    analytics.excludeBrowserByDefault();
    analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(fetcher).not.toHaveBeenCalled();
    analytics.setBrowserExcluded(false);
    analytics.excludeBrowserByDefault(); // signing in again does not undo the choice
    expect(local.get("adcode.website-analytics-exclude")).toBe("0");
    analytics.trackWebsiteEvent("page_view"); analytics.flushWebsiteAnalytics();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
