"use client";

import Link from "next/link";
import { useState } from "react";
import { GROWTH_LOOPS, loopVisits, SURFACE_LABEL, untaggedVisits } from "@/lib/loops";
import { useWebsiteReport, WindowPicker } from "./useGrowthData";

/**
 * Every growth loop on one screen: where it lives, what it asks, what the sharer gets, and
 * how many invite-page visits its links brought. A loop whose result shows somewhere else
 * says where, and links there.
 */
export function LoopsBoard() {
  const [days, setDays] = useState(30);
  const report = useWebsiteReport(days);
  const pages = report.value?.invitePages;
  const other = untaggedVisits(pages);
  const capped = days === 0 || days > 90;

  return (
    <div className="growth-loops">
      <WindowPicker days={days} onChange={setDays} loading={report.loading} onRefresh={() => void report.reload()} />
      {report.error !== null && <p role="alert">{report.error}</p>}
      {report.value !== null && pages === undefined && (
        <p className="website-analytics-note">This server does not count visits per loop yet. Deploy the web to start.</p>
      )}

      <ul className="growth-loop-list">
        {GROWTH_LOOPS.map((loop) => {
          const visits = loopVisits(loop, pages);
          return (
            <li key={loop.id} className="website-analytics-card growth-loop">
              <div className="growth-loop-head">
                <h2>{loop.name}</h2>
                <span className="growth-loop-surface" data-surface={loop.surface}>{SURFACE_LABEL[loop.surface]}</span>
              </div>
              <p>{loop.ask}</p>
              <dl className="growth-loop-facts">
                <div><dt>Sharer gets</dt><dd>{loop.reward}</dd></div>
                <div>
                  <dt>{loop.tags.length > 0 ? "Invite-page visits" : "Measured in"}</dt>
                  <dd>
                    {loop.tags.length > 0
                      ? visits === null ? "—" : visits.toLocaleString("en-US")
                      : loop.measure}
                  </dd>
                </div>
                {loop.tags.length > 0 && <div><dt>Link tag</dt><dd className="mono">{loop.tags.map((tag) => (tag === "advertiser-pitch" ? "for=ads" : `from=${tag}`)).join(", ")}</dd></div>}
              </dl>
              {loop.editorAfter !== undefined && <p className="website-analytics-note">In the editor from the first desktop release after {loop.editorAfter}.</p>}
              {loop.manage !== undefined && <Link className="btn btn-small" href={loop.manage.href}>{loop.manage.label}</Link>}
            </li>
          );
        })}
      </ul>

      {other !== null && (
        <p className="website-analytics-note">
          {other.toLocaleString("en-US")} other invite-page visit{other === 1 ? "" : "s"} carried no loop tag: links copied from
          Invite &amp; earn, older links, and people who typed the address.
        </p>
      )}
      <p className="website-analytics-note">
        Visits count consenting visitors only, {capped ? "over the last 90 days (the website report's limit)" : "in this period"}.
        Who stayed and what they earned is in Overview and Partners.
      </p>
    </div>
  );
}
