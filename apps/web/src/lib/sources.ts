/**
 * The admin Sources table, as words and figures. Pure; the panel renders what these return.
 *
 * Every money figure is formatted exactly from the decimal string the API sent - the same
 * rule the dashboard follows - because at today's volume most of them are fractions of a
 * cent, and a rounded "$0.00" would say a source earned nothing when it earned something.
 */
import { moneyExact } from "@/components/money";

export interface SourceRowView {
  key: string;
  kind: "campaign" | "users" | "unknown";
  code: string | null;
  label: string;
  visits: number | null;
  people: number;
  realUsers: number;
  cameBack: number;
  adRevenueMicros: string;
  advertisers: number;
  advertiserSpendMicros: string;
  paidMicros: string;
  keptMicros: string;
}

export interface ReferrerRowView extends Omit<SourceRowView, "key" | "kind" | "label" | "code"> {
  referrerUid: string;
  code: string;
}

export interface SourcesView {
  days: number;
  asOf: number;
  rows: SourceRowView[];
  topReferrers: ReferrerRowView[];
  coverage: { attributedRealUsers: number; realUsers: number };
}

export const SOURCE_COLUMNS = [
  "Source",
  "Visits",
  "People",
  "Real users",
  "Came back",
  "Ad revenue",
  "Advertisers",
  "Advertiser spend",
  "Paid out",
  "ADCode kept",
] as const;

function name(row: SourceRowView): string {
  if (row.kind !== "campaign" || row.code === null) return row.label;
  return row.label === "" ? row.code : `${row.label} (${row.code})`;
}

export function sourceCells(row: SourceRowView): string[] {
  return [
    name(row),
    row.visits === null ? "—" : row.visits.toLocaleString("en-US"),
    row.people.toLocaleString("en-US"),
    row.realUsers.toLocaleString("en-US"),
    row.cameBack.toLocaleString("en-US"),
    moneyExact(row.adRevenueMicros),
    row.advertisers.toLocaleString("en-US"),
    moneyExact(row.advertiserSpendMicros),
    moneyExact(row.paidMicros),
    moneyExact(row.keptMicros),
  ];
}

export function coverageText(coverage: SourcesView["coverage"]): string {
  if (coverage.realUsers === 0) return "No new real users in this window yet.";
  const percent = Math.round((coverage.attributedRealUsers / coverage.realUsers) * 100);
  return `${percent}% of new real users came with a code (${coverage.attributedRealUsers} of ${coverage.realUsers}).`;
}

export function windowLabel(days: number): string {
  return days === 0 ? "All time" : `Last ${days} days`;
}
