"use client";

import Link from "next/link";
import { useState } from "react";
import { moneyExact } from "@/components/money";
import type { ReferrerRowView } from "@/lib/sources";
import { useSources, WindowPicker } from "./useGrowthData";

/** Everything a partner's people and advertisers brought in: ad revenue plus advertiser spend. */
export function broughtIn(row: Pick<ReferrerRowView, "adRevenueMicros" | "advertiserSpendMicros">): string {
  return (BigInt(row.adRevenueMicros) + BigInt(row.advertiserSpendMicros)).toString();
}

/**
 * The people who invite: one row per partner with results in the period, best first, and
 * a way into each account (People shows who they invited and who invited them).
 */
export function PartnersTable() {
  const [days, setDays] = useState(30);
  const sources = useSources(days);
  const partners = sources.value?.topReferrers ?? [];

  return (
    <div className="growth-partners">
      <WindowPicker days={days} onChange={setDays} loading={sources.loading} onRefresh={() => void sources.reload()} />
      {sources.loading && sources.value === null && <p role="status">Loading…</p>}
      {sources.error !== null && <p role="alert">{sources.error}</p>}

      {sources.value !== null && partners.length === 0 && (
        <section className="website-analytics-card growth-empty">
          <h2>No partner has brought anyone in this period</h2>
          <p className="website-analytics-note">
            Everyone with an account has an invite link - in the editor&apos;s Invite &amp; earn and on their dashboard.
            A partner appears here once someone claims their code. Try All time, or see which loops are sending visits in Loops.
          </p>
          <Link className="btn btn-small btn-outline" href="/admin/growth?tab=loops">Open Loops</Link>
        </section>
      )}

      {partners.length > 0 && (
        <section className="website-analytics-card sources-card" aria-labelledby="growth-partners-heading">
          <h2 id="growth-partners-heading">Partners</h2>
          <div className="sources-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Partner</th>
                  <th scope="col">Code</th>
                  <th scope="col">People</th>
                  <th scope="col">Real users</th>
                  <th scope="col">Came back</th>
                  <th scope="col">Advertisers</th>
                  <th scope="col">Brought in</th>
                  <th scope="col">Paid out</th>
                  <th scope="col">ADCode kept</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((row) => (
                  <tr key={row.referrerUid}>
                    <th scope="row"><Link className="mono" href={`/admin/people?q=${encodeURIComponent(row.referrerUid)}`}>{row.referrerUid}</Link></th>
                    <td className="mono">{row.code}</td>
                    <td>{row.people.toLocaleString("en-US")}</td>
                    <td>{row.realUsers.toLocaleString("en-US")}</td>
                    <td>{row.cameBack.toLocaleString("en-US")}</td>
                    <td>{row.advertisers.toLocaleString("en-US")}</td>
                    <td>{moneyExact(broughtIn(row))}</td>
                    <td>{moneyExact(row.paidMicros)}</td>
                    <td>{moneyExact(row.keptMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="website-analytics-note">
            Brought in is what their people&apos;s ad views earned plus what their advertisers spent, since each one
            arrived. Open a partner to see exactly who they invited.
          </p>
        </section>
      )}
    </div>
  );
}
