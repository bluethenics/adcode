import { describe, expect, it } from "vitest";
import {
  IMPACT_LABELS,
  INCIDENT_STATUS_LABELS,
  LEVEL_LABELS,
  shownLevel,
  parseStatusView,
} from "../src/lib/status";

/**
 * The status page's reader.
 *
 * `readStatus` fails to null rather than to an error - a status page that 500s because its
 * API blipped is worse than one that says so - and that promise rests on this parser: a
 * garbled answer must never reach the page as a broken render.
 */
const good = () => ({
  asOf: 1_790_000_000_000,
  windowDays: 90,
  overall: { state: "operational", title: "All systems operational", activeIncidents: 0 },
  models: [
    {
      provider: "tagflow",
      providerName: "Tagflow AI",
      model: "tagflow-code-27b",
      name: "Tagflow Code 27B",
      state: "operational",
      turns: 10,
      ok: 9,
      uptimePct: 90,
      errorPct: 10,
      avgMs: 1_200,
      lastActiveDay: "2026-10-19",
      days: [{ day: "2026-10-19", level: "operational", turns: 10, errors: 1, avgMs: 1_200 }],
    },
  ],
  incidents: [
    {
      incidentId: "inc-1",
      title: "Elevated errors",
      impact: "major",
      status: "resolved",
      createdAt: 1_790_000_000_000,
      updatedAt: 1_790_000_100_000,
      resolvedAt: 1_790_000_100_000,
      updates: [
        { updateId: "u-1", status: "resolved", body: "Fixed.", createdAt: 1_790_000_100_000 },
      ],
    },
  ],
});

describe("parseStatusView", () => {
  it("keeps the live measurement window separate from historical candles", () => {
    expect(parseStatusView({ ...good(), liveWindowMinutes: 15 })?.liveWindowMinutes).toBe(15);
    expect(parseStatusView(good())?.liveWindowMinutes).toBeUndefined();
  });
  it("reads two-hour candles and drops malformed intervals without inventing data", () => {
    const raw = good();
    const candle = { startAt: 1_790_000_000_000, endAt: 1_790_007_200_000, level: "operational", turns: 10, errors: 0, avgMs: 1_200 };
    const view = parseStatusView({ ...raw, models: [{ ...raw.models[0], candles: [candle, { ...candle, endAt: 1 }, null] }] });
    expect(view?.models[0]?.candles).toEqual([candle]);
    expect(parseStatusView(raw)?.models[0]?.candles).toBeUndefined();
  });
  it("reads a well-formed answer whole", () => {
    const view = parseStatusView(good());
    expect(view?.windowDays).toBe(90);
    expect(view?.overall.state).toBe("operational");
    expect(view?.models[0]).toMatchObject({
      name: "Tagflow Code 27B",
      providerName: "Tagflow AI",
      uptimePct: 90,
    });
    expect(view?.models[0]?.days[0]).toMatchObject({ day: "2026-10-19", level: "operational" });
    expect(view?.incidents[0]).toMatchObject({ status: "resolved", resolvedAt: 1_790_000_100_000 });
    expect(view?.incidents[0]?.updates).toHaveLength(1);
  });

  it.each([
    ["nothing", undefined],
    ["a string", "ok"],
    ["an overall that is not an object", { ...good(), overall: "fine" }],
    ["no state", { ...good(), overall: { title: "ok", activeIncidents: 0 } }],
    ["no window", { ...good(), windowDays: "ninety" }],
  ])("refuses %s", (_label, raw) => {
    expect(parseStatusView(raw)).toBeNull();
  });

  it("falls back to the raw provider when the answer carries no display name", () => {
    const view = parseStatusView({
      ...good(),
      models: [
        {
          provider: "tagflow",
          model: "tagflow-code-27b",
          name: "Tagflow Code 27B",
          state: "operational",
          turns: 10,
          ok: 9,
          days: [],
        },
      ],
    });
    expect(view?.models[0]?.providerName).toBe("tagflow");
  });

  it("keeps the models it can read when a sibling is malformed", () => {
    const view = parseStatusView({
      ...good(),
      models: [good().models[0], { provider: "groq" }, "not a model"],
    });
    expect(view?.models).toHaveLength(1);
  });

  it("gives an incident with no updates an empty timeline rather than dropping it", () => {
    const view = parseStatusView({
      ...good(),
      incidents: [{ ...good().incidents[0], updates: undefined }],
    });
    expect(view?.incidents[0]?.updates).toEqual([]);
  });

  it("leaves missing list fields as empty lists", () => {
    const view = parseStatusView({ ...good(), models: undefined, incidents: undefined });
    expect(view?.models).toEqual([]);
    expect(view?.incidents).toEqual([]);
  });
});

describe("labels", () => {
  it("shows a period with no requests as operational on the public page, and nothing else", () => {
    expect(shownLevel("quiet")).toBe("operational");
    for (const level of ["operational", "degraded", "outage", "maintenance"]) expect(shownLevel(level)).toBe(level);
  });
  it("names every level, state and impact the API can send", () => {
    for (const level of ["operational", "degraded", "outage", "maintenance", "quiet"]) {
      expect(LEVEL_LABELS[level], level).toBeTruthy();
    }
    for (const status of ["investigating", "identified", "monitoring", "resolved"]) {
      expect(INCIDENT_STATUS_LABELS[status], status).toBeTruthy();
    }
    for (const impact of ["none", "minor", "major", "critical", "maintenance"]) {
      expect(IMPACT_LABELS[impact], impact).toBeTruthy();
    }
  });
});
