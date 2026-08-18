import { describe, it, expect, beforeEach } from "vitest";
import { handleSubmitReport, handleAdminListReports } from "../src/reports.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { parseReportRequest, REPORT_LIMITS } from "../src/contract.ts";

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => 4_000 },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

const body = {
  kind: "bug",
  title: "Terminal freezes on split",
  body: "Splitting the terminal a third time stops accepting input.",
  appVersion: "0.1.0",
  platform: "win32",
};

beforeEach(() => {
  counter = 0;
  store = createMemoryStore();
});

describe("parseReportRequest", () => {
  it("accepts a well-formed report", () => {
    expect(parseReportRequest(body)).toEqual(body);
  });

  it("accepts every kind the UI offers", () => {
    for (const kind of ["bug", "feature", "help", "other"]) {
      expect(parseReportRequest({ ...body, kind })).not.toBeNull();
    }
  });

  it("rejects an unknown kind", () => {
    expect(parseReportRequest({ ...body, kind: "lawsuit" })).toBeNull();
  });

  it("rejects an empty title or body, since neither is actionable", () => {
    expect(parseReportRequest({ ...body, title: "   " })).toBeNull();
    expect(parseReportRequest({ ...body, body: "" })).toBeNull();
  });

  it("rejects text past the limits rather than silently truncating", () => {
    expect(parseReportRequest({ ...body, title: "x".repeat(REPORT_LIMITS.title + 1) })).toBeNull();
    expect(parseReportRequest({ ...body, body: "x".repeat(REPORT_LIMITS.body + 1) })).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseReportRequest({ ...body, title: "  spaced  " })?.title).toBe("spaced");
  });

  it("rejects a non-object", () => {
    expect(parseReportRequest(null)).toBeNull();
    expect(parseReportRequest("bug")).toBeNull();
  });
});

describe("handleSubmitReport", () => {
  it("stores the report and returns its id", async () => {
    const res = await handleSubmitReport(deps(), "u-1", parseReportRequest(body)!);
    expect(res.reportId).toBe("rep-1");
  });

  it("attributes the report to the verified uid, not anything in the body", async () => {
    await handleSubmitReport(deps(), "u-1", parseReportRequest(body)!);
    const page = await store.listReports({ limit: 10, cursor: null });
    expect(page.rows[0]?.uid).toBe("u-1");
  });

  it("opens every report in the open state", async () => {
    await handleSubmitReport(deps(), "u-1", parseReportRequest(body)!);
    const page = await store.listReports({ limit: 10, cursor: null });
    expect(page.rows[0]?.status).toBe("open");
  });

  it("keeps the version and platform, which are the first things triage needs", async () => {
    await handleSubmitReport(deps(), "u-1", parseReportRequest(body)!);
    const row = (await store.listReports({ limit: 10, cursor: null })).rows[0];
    expect(row?.appVersion).toBe("0.1.0");
    expect(row?.platform).toBe("win32");
  });
});

describe("handleAdminListReports", () => {
  beforeEach(async () => {
    for (let i = 1; i <= 3; i++) {
      await store.createReport({
        reportId: `rep-${i}`,
        uid: "u-1",
        kind: "bug",
        title: `Report ${i}`,
        body: "x",
        appVersion: "0.1.0",
        platform: "win32",
        status: "open",
        createdAt: i,
      });
    }
  });

  it("lists reports newest first", async () => {
    const res = await handleAdminListReports(deps(), "admin-1", { limit: 10, cursor: null });
    expect(res.rows.map((r) => r.reportId)).toEqual(["rep-3", "rep-2", "rep-1"]);
  });

  it("paginates", async () => {
    const first = await handleAdminListReports(deps(), "admin-1", { limit: 2, cursor: null });
    expect(first.rows).toHaveLength(2);
    const second = await handleAdminListReports(deps(), "admin-1", { limit: 2, cursor: first.nextCursor });
    expect(second.rows.map((r) => r.reportId)).toEqual(["rep-1"]);
  });

  it("audits the read, because reports carry user-written text", async () => {
    await handleAdminListReports(deps(), "admin-1", { limit: 10, cursor: null });
    expect(await store.listAudit()).toEqual([
      { adminUid: "admin-1", action: "read-reports", subjectUid: "*", at: 4_000 },
    ]);
  });
});
