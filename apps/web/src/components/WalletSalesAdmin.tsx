"use client";

/** Admin: the plans on sale with what each costs at full use, and paid USD credit top-ups by day. */
import { useCallback, useEffect, useState } from "react";
import { PLANS_ON_SALE } from "@adcode/api/src/aiPlans.ts";
import { dollars } from "@/app/ai-tokens/tokenFormatting";

type AdminCall = <T>(path: string, body?: unknown) => Promise<T>;
export interface WalletSalesDay { day: string; orders: number; typedOrders: number; revenueCents: number; refundedOrders: number }

/** What ADCode pays per credit at most (85% of a $0.001 list credit) and the payment fee share. */
const COST_PER_CREDIT_CENTS = 0.085;
const FEE_SHARE = 0.05;
/** A plan's worst case: every credit used every day, for the billing period, plus fees. */
export const fullUseCostCents = (dailyCredits: number, days: number, chargeCents: number): number => Math.round(dailyCredits * days * COST_PER_CREDIT_CENTS + chargeCents * FEE_SHARE);

export function PlanCatalogueTable() {
  return <div className="admin-models-scroll" role="region" aria-label="Plans on sale" tabIndex={0}><table className="admin-models-table">
    <thead><tr><th scope="col">Plan</th><th scope="col">Monthly</th><th scope="col">Yearly</th><th scope="col">Credits a day</th><th scope="col">Full-use cost, month</th><th scope="col">Full-use cost, year</th></tr></thead>
    <tbody>{PLANS_ON_SALE.map((plan) => {
      const credits = plan.weeklyTokens / 11_000;
      const month = fullUseCostCents(credits, 30, plan.priceCents);
      const year = plan.yearlyCents === undefined ? null : fullUseCostCents(credits, 365, plan.yearlyCents);
      return <tr key={plan.id}>
        <td>{plan.name}</td><td>{dollars(plan.priceCents)}</td><td>{plan.yearlyCents === undefined ? "-" : dollars(plan.yearlyCents)}</td>
        <td>{credits.toLocaleString("en-US")}</td>
        <td>{dollars(month)} ({plan.priceCents - month >= 0 ? "+" : "-"}{dollars(Math.abs(plan.priceCents - month))})</td>
        <td>{year === null ? "-" : `${dollars(year)} (${plan.yearlyCents! - year >= 0 ? "+" : "-"}${dollars(Math.abs(plan.yearlyCents! - year))})`}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function WalletSalesTable({ days }: { days: readonly WalletSalesDay[] }) {
  if (days.length === 0) return <p className="row-sub">No paid credit top-ups in this period.</p>;
  const total = days.reduce((sum, day) => ({ orders: sum.orders + day.orders, typed: sum.typed + day.typedOrders, revenue: sum.revenue + day.revenueCents, refunded: sum.refunded + day.refundedOrders }), { orders: 0, typed: 0, revenue: 0, refunded: 0 });
  return <div className="admin-models-scroll" role="region" aria-label="Credit top-ups by day" tabIndex={0}><table className="admin-models-table">
    <thead><tr><th scope="col">Day (UTC)</th><th scope="col">Paid top-ups</th><th scope="col">Typed amounts</th><th scope="col">Revenue</th><th scope="col">Refunded or disputed</th></tr></thead>
    <tbody>{days.map((day) => <tr key={day.day}><td>{day.day}</td><td>{day.orders}</td><td>{day.typedOrders}</td><td>{dollars(day.revenueCents)}</td><td>{day.refundedOrders}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">Total</th><td>{total.orders}</td><td>{total.typed}</td><td>{dollars(total.revenue)}</td><td>{total.refunded}</td></tr></tfoot>
  </table></div>;
}

export function WalletSalesAdmin({ call }: { call: AdminCall }) {
  const [days, setDays] = useState<WalletSalesDay[] | null>(null);
  const [range, setRange] = useState<{ minCents: number; maxCents: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setError("");
    try { const result = await call<{ days: WalletSalesDay[]; range?: { minCents: number; maxCents: number } }>("/admin/ai-wallet/sales?days=30"); setDays(result.days); setRange(result.range ?? null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't load credit sales."); }
    finally { setLoading(false); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);
  return <div className="plans-admin-group">
    <header className="admin-card-head"><h4>Credit top-ups, last 30 days</h4><button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh sales"}</button></header>
    {error && <p className="notice" data-tone="error" role="alert">{error} Use Refresh sales to retry.</p>}
    {loading && days === null ? <p className="row-sub" role="status">Loading credit sales…</p> : days !== null && <WalletSalesTable days={days} />}
    <p className="row-sub">Buyers can type any whole-dollar amount{range === null ? "" : ` from ${dollars(range.minCents)} to ${dollars(range.maxCents)}`}; amounts other than the $10, $20, $50 and $100 buttons count as typed. Revenue excludes tax and refunded orders.</p>
  </div>;
}
