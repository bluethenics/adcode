/**
 * Bug reports, feature requests, and help asks.
 *
 * The report is attributed to the verified UID from the token, never to anything in the
 * body - the same rule the money endpoints follow, for the same reason: a field the
 * client controls is a field the client can lie about.
 *
 * Reports carry user-written prose, so an admin reading them is audited exactly as an
 * admin reading a ledger is. The audit row uses `*` as its subject because a list read
 * is not about one person.
 */
import type { SubmitReportBody, SubmitReportResponse } from "./contract.ts";
import type { Clock, IdGen, Page, ReportPage, Store } from "./store.ts";

export interface ReportDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

export async function handleSubmitReport(
  deps: ReportDeps,
  uid: string,
  body: SubmitReportBody,
): Promise<SubmitReportResponse> {
  const reportId = deps.ids.next("rep");

  await deps.store.createReport({
    reportId,
    uid,
    kind: body.kind,
    title: body.title,
    body: body.body,
    appVersion: body.appVersion,
    platform: body.platform,
    status: "open",
    createdAt: deps.clock.now(),
  });

  return { reportId };
}

export async function handleAdminListReports(
  deps: ReportDeps,
  adminUid: string,
  page: Page,
): Promise<ReportPage> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-reports",
    subjectUid: "*",
    at: deps.clock.now(),
  });

  return deps.store.listReports(page);
}
