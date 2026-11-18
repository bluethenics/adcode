"use client";

import Link from "next/link";
import { ArrowUpRight, LogOut } from "lucide";
import { Icon } from "@/components/Icon";
import { ReferAdvertiser } from "@/components/ReferAdvertiser";
import { SignInCard } from "@/components/SignInCard";
import { PortalError, PortalSkeleton, usePortal } from "@/components/advertisers/portal/PortalShell";
import { signOutNow } from "@/lib/firebase";
import { TEAM } from "@/lib/site";

export default function PortalSettings() {
  const portal = usePortal();

  if (portal.status === "checking" || portal.status === "loading") return <PortalSkeleton />;
  if (portal.status === "signed-out") return <div className="ap-signin"><SignInCard heading="Sign in to your advertiser account" audience="advertiser" headingTag="h2" initialMode="in" /></div>;
  if (portal.status === "error") return <PortalError message={portal.error} onRetry={() => void portal.reload()} />;

  return (
    <>
      <header className="ap-page-head">
        <div>
          <h1>Settings</h1>
          <p>Your advertiser account and the ADCode sign-in that owns it.</p>
        </div>
      </header>

      <section className="ap-panel" aria-labelledby="ap-account-title">
        <h2 id="ap-account-title">Advertiser account</h2>
        {portal.advertiser === null ? (
          <p className="ap-note">No advertiser account yet. It is created, named after your brand, when you launch your first campaign.</p>
        ) : (
          <dl className="ap-facts">
            <div><dt>Name</dt><dd>{portal.advertiser.name}</dd></div>
            <div><dt>Status</dt><dd>{portal.advertiser.status === "suspended" ? "Suspended" : "Active"}</dd></div>
            <div><dt>Account ID</dt><dd className="mono">{portal.advertiser.advertiserId}</dd></div>
          </dl>
        )}
        <p className="ap-note">To rename the account or change who owns it, email <a className="ap-link" href="mailto:adcode.support@gmail.com">adcode.support@gmail.com</a>.</p>
      </section>

      <section className="ap-panel" aria-labelledby="ap-signin-title">
        <h2 id="ap-signin-title">Signed in as</h2>
        <div className="ap-signed-in">
          <span className="mono">{portal.email ?? "Your ADCode account"}</span>
          <button type="button" className="ap-btn" disabled={portal.preview} onClick={() => void signOutNow()}><Icon node={LogOut} />Sign out</button>
        </div>
      </section>

      <ReferAdvertiser />

      <section className="ap-panel" aria-labelledby="ap-help-title">
        <h2 id="ap-help-title">Help</h2>
        <ul className="ap-help">
          <li><Link href="/advertisers" className="ap-link">How pricing and verified views work<Icon node={ArrowUpRight} /></Link></li>
          <li><Link href="/support" className="ap-link">Contact support<Icon node={ArrowUpRight} /></Link></li>
          <li><a href={TEAM.bookingUrl} target="_blank" rel="noopener noreferrer" className="ap-link">Book a call about a larger launch<Icon node={ArrowUpRight} /></a></li>
        </ul>
      </section>
    </>
  );
}
