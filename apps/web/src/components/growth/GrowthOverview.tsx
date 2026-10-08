"use client";

import Link from "next/link";
import { useState } from "react";
import { moneyExact } from "@/components/money";
import { coverageText, sourceCells, SOURCE_COLUMNS } from "@/lib/sources";
import { useCampaignCodes, useReferralConfig, useSources, WindowPicker } from "./useGrowthData";

/** Minutes until the next 00:30 UTC, when pg_cron settles the last seven days. */
export function nextSettlement(now: number): { at: number; label: string } {
  const day = 86_400_000;
  const todayRun = Math.floor(now / day) * day + 30 * 60_000;
  const at = now < todayRun ? todayRun : todayRun + day;
  const minutes = Math.ceil((at - now) / 60_000);
  const label = minutes >= 60 ? `in ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `in ${minutes} min`;
  return { at, label };
}

interface Step {
  done: boolean;
  title: string;
  detail: string;
  action?: { href: string; label: string };
}

/**
 * Growth at a glance: what is still to set up, what invites brought in, and where every
 * new person came from. The checklist only lists what this page can check for itself.
 */
export function GrowthOverview() {
  const [days, setDays] = useState(30);
  const sources = useSources(days);
  const config = useReferralConfig();
  const codes = useCampaignCodes();

  const live = config.value !== null;
  const steps: Step[] = [
    {
      done: live,
      title: "Invites are switched on",
      detail: live ? "The invite tables are live, and invite pages and the API answer." : config.loading ? "Checking…" : "The invite API is not answering. Apply the referrals migration.",
    },
    {
      done: (config.value?.houseAdvertiserIds.length ?? 0) > 0,
      title: "ADCode's own advertisers are marked",
      detail: "Their spend is ADCode paying itself, so it must never pay an invite share.",
      action: { href: "/admin/growth?tab=terms", label: "Mark them in Terms" },
    },
    {
      done: (codes.value?.codes.length ?? 0) > 0,
      title: "A campaign link for your posts",
      detail: "Each post or ad you run gets a row of its own in Sources instead of joining \"no source\".",
      action: { href: "/admin/growth?tab=links", label: "Make one in Links" },
    },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  const settlement = nextSettlement(Date.now());
  const users = sources.value?.rows.find((row) => row.kind === "users");

  return (
    <div className="growth-overview">
      <section className="website-analytics-card growth-setup" aria-labelledby="growth-setup-heading">
        <h2 id="growth-setup-heading">{remaining === 0 ? "Set up" : `${remaining} thing${remaining === 1 ? "" : "s"} to set up`}</h2>
        <ol className="growth-steps">
          {steps.map((step) => (
            <li key={step.title} data-done={step.done}>
              <span className="growth-step-mark" aria-hidden="true">{step.done ? "✓" : ""}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
              {!step.done && step.action !== undefined && <Link className="btn btn-small btn-outline" href={step.action.href}>{step.action.label}</Link>}
              <span className="sr-only">{step.done ? "Done" : "Not done"}</span>
            </li>
          ))}
        </ol>
        <p className="website-analytics-note">
          Partners are paid every night at 00:30 UTC for the last seven days ({settlement.label}); a day already paid
          pays nothing again. The editor&apos;s invite loops reach people with the first desktop release after 2.1.1.
        </p>
      </section>

      <WindowPicker days={days} onChange={setDays} loading={sources.loading} onRefresh={() => void sources.reload()} />
      {sources.loading && sources.value === null && <p role="status">Loading…</p>}
      {sources.error !== null && <p role="alert">{sources.error}</p>}

      {sources.value !== null && (
        <>
          <div className="admin-tiles">
            <div className="admin-tile"><strong>{(users?.people ?? 0).toLocaleString("en-US")}</strong><span>Came with an invite</span><small>{(users?.realUsers ?? 0).toLocaleString("en-US")} used ADCode, {(users?.cameBack ?? 0).toLocaleString("en-US")} came back</small></div>
            <div className="admin-tile"><strong>{(users?.advertisers ?? 0).toLocaleString("en-US")}</strong><span>Advertisers brought by partners</span><small>{moneyExact(users?.advertiserSpendMicros ?? "0")} spent since</small></div>
            <div className="admin-tile"><strong>{moneyExact(users?.paidMicros ?? "0")}</strong><span>Paid to partners</span><small>{sources.value.topReferrers.length.toLocaleString("en-US")} partner{sources.value.topReferrers.length === 1 ? "" : "s"} with results</small></div>
            <div className="admin-tile"><strong>{sources.value.coverage.realUsers === 0 ? "—" : `${Math.round((sources.value.coverage.attributedRealUsers / sources.value.coverage.realUsers) * 100)}%`}</strong><span>New real users with a source</span><small>{sources.value.coverage.attributedRealUsers} of {sources.value.coverage.realUsers}</small></div>
          </div>

          <section className="website-analytics-card sources-card" aria-labelledby="growth-sources-heading">
            <h2 id="growth-sources-heading">Where people came from</h2>
            <p className="website-analytics-note">{coverageText(sources.value.coverage)} Grouped by when people arrived; money is everything they brought since.</p>
            <div className="sources-scroll">
              <table>
                <thead><tr>{SOURCE_COLUMNS.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
                <tbody>
                  {sources.value.rows.map((row) => (
                    <tr key={row.key} data-kind={row.kind}>
                      {sourceCells(row).map((cell, index) => (index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="website-analytics-note">
              Visits count consenting visitors to each invite page. Real users were seen using ADCode at least once;
              came back means seen on two or more days. A view by an invited person of an ad from an invited
              advertiser counts in both rows, so the money columns are not added up across rows.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
