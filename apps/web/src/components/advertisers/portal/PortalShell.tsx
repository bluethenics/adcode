"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, CreditCard, LayoutGrid, LogOut, Menu, Plus, Settings, X } from "lucide";
import { useAuth } from "@/components/AuthProvider";
import { Icon } from "@/components/Icon";
import { Mark } from "@/components/Mark";
import { MESSAGES, type AdvertiserView, type CampaignView, type SeriesPointView } from "@/lib/api";
import { loadPortalReport } from "@/lib/portalReport";
import { campaignState } from "@/lib/portalModel";
import { portalPreview } from "@/lib/portalPreview";
import { signOutNow } from "@/lib/firebase";
import { BannedAccount } from "@/components/BannedAccount";

/**
 * The advertiser portal's frame, mounted once in `app/portal/layout.tsx` so the sidebar and
 * the report it reads survive moving between pages.
 *
 * The report is loaded here, once, and shared: the sidebar lists campaigns with their state,
 * the overview charts them, a campaign page reads its row. Three pages each fetching the
 * same three endpoints could disagree for a refresh cycle; one load cannot.
 */

export type PortalWindow = "7" | "30" | "90";

export type PortalStatus = "checking" | "signed-out" | "loading" | "none" | "ready" | "error";

export interface PortalData {
  status: PortalStatus;
  /** Who is signed in, for the account block. Null when signed out. */
  email: string | null;
  advertiser: AdvertiserView | null;
  campaigns: CampaignView[];
  series: SeriesPointView[];
  error: string | null;
  window: PortalWindow;
  setWindow: (next: PortalWindow) => void;
  reload: () => Promise<void>;
  token: () => Promise<string | null>;
  /** True in the development preview, where writes are pretend. */
  preview: boolean;
  /** The overview shows its sign-in card once someone asks for it, from anywhere in the portal. */
  signInAsked: boolean;
  askSignIn: () => void;
}

const PortalContext = createContext<PortalData | null>(null);

export function usePortal(): PortalData {
  const value = useContext(PortalContext);
  if (value === null) throw new Error("usePortal outside PortalShell");
  return value;
}

function usePortalData(): PortalData {
  const auth = useAuth();
  const [preview, setPreview] = useState(false);
  const [advertiser, setAdvertiser] = useState<AdvertiserView | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [series, setSeries] = useState<SeriesPointView[]>([]);
  const [window, setWindow] = useState<PortalWindow>("30");
  const [status, setStatus] = useState<PortalStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const [signInAsked, setSignInAsked] = useState(false);
  const requestId = useRef(0);

  useEffect(() => setPreview(portalPreview() !== null), []);

  const signedIn = preview || auth.user !== null;
  const token = useCallback(async () => (preview ? "preview" : auth.token()), [auth, preview]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    const found = await token()
      .then((t) => loadPortalReport(t, window))
      .catch(() => ({ ok: false as const, error: "offline" as const }));
    if (id !== requestId.current) return;
    if (!found.ok) {
      if (found.error === "no-advertiser") {
        setAdvertiser(null);
        setCampaigns([]);
        setSeries([]);
        setStatus("none");
        return;
      }
      setError(MESSAGES[found.error]);
      setStatus("error");
      return;
    }
    setAdvertiser(found.value.advertiser);
    setCampaigns(found.value.campaigns);
    setSeries(found.value.series);
    setError(null);
    setStatus("ready");
  }, [token, window]);

  useEffect(() => {
    if (!preview && auth.loading) {
      setStatus("checking");
      return;
    }
    if (!signedIn) {
      setStatus("signed-out");
      return;
    }
    // Keep showing the last report while a new reporting window loads.
    setStatus((current) => (current === "ready" ? current : "loading"));
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = globalThis.setInterval(refresh, 30_000);
    globalThis.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      ++requestId.current;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [auth.loading, preview, reload, signedIn]);

  return {
    status,
    email: preview ? "maya@tracewell.dev" : (auth.user?.email ?? null),
    advertiser,
    campaigns,
    series,
    error,
    window,
    setWindow,
    reload,
    token,
    preview,
    signInAsked,
    askSignIn: () => setSignInAsked(true),
  };
}

const NAV = [
  { href: "/portal", label: "Overview", icon: LayoutGrid },
  { href: "/portal/billing", label: "Billing", icon: CreditCard },
  { href: "/portal/settings", label: "Settings", icon: Settings },
] as const;

export function PortalShell({ children }: { children: React.ReactNode }) {
  const data = usePortalData();
  const { banned } = useAuth();
  const pathname = usePathname() ?? "/portal";
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  // Moving to another page closes the phone's sheet.
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [drawer]);

  const value = useMemo(() => data, [data]);
  const accountName = data.advertiser?.name ?? (data.status === "signed-out" ? "Advertise on ADCode" : "New advertiser");

  const rail = (
    <nav className="ap-rail-inner" aria-label="Advertiser portal">
      <div className="ap-account">
        <span className="ap-account-mark" aria-hidden="true">
          {data.advertiser === null ? <Mark size={18} /> : data.advertiser.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="ap-account-text">
          <strong>{accountName}</strong>
          <small>{data.advertiser === null ? "Advertiser account" : data.advertiser.status === "suspended" ? "Suspended" : "Advertiser"}</small>
        </span>
      </div>

      <Link href="/portal/campaigns/new" className="ap-new" aria-current={pathname === "/portal/campaigns/new" ? "page" : undefined}>
        <Icon node={Plus} />New campaign
      </Link>

      <ul className="ap-nav">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              <Icon node={item.icon} />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="ap-campaigns">
        <h2>Campaigns</h2>
        {data.status === "ready" && data.campaigns.length > 0 ? (
          <ul>
            {data.campaigns.map((campaign) => {
              const state = campaignState(campaign, data.advertiser);
              const href = `/portal/campaigns/${encodeURIComponent(campaign.campaignId)}`;
              return (
                <li key={campaign.campaignId}>
                  <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                    <span className="ap-campaign-name">{campaign.name}</span>
                    <span className="ap-state-dot" data-tone={state.tone} aria-hidden="true" />
                    <span className="sr-only">{state.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : data.status === "loading" || data.status === "checking" ? (
          <div className="ap-rail-skeleton" aria-hidden="true"><i /><i /></div>
        ) : (
          <p>{data.status === "signed-out" ? "Sign in to see yours." : data.status === "error" ? "Couldn't load." : "No campaigns yet."}</p>
        )}
      </div>

      <div className="ap-user">
        {data.status === "signed-out" ? (
          <button
            type="button"
            className="ap-user-signin"
            onClick={() => {
              data.askSignIn();
              setDrawer(false);
              if (pathname !== "/portal") router.push("/portal");
            }}
          >
            Sign in
          </button>
        ) : data.email !== null || data.status !== "checking" ? (
          <>
            <span className="ap-user-mark" aria-hidden="true">{(data.email ?? "?").slice(0, 1).toUpperCase()}</span>
            <span className="ap-user-email" title={data.email ?? undefined}>{data.email ?? "Signed in"}</span>
            <button
              type="button"
              className="ap-icon-button"
              aria-label="Sign out"
              title="Sign out"
              disabled={data.preview}
              onClick={() => void signOutNow()}
            >
              <Icon node={LogOut} />
            </button>
          </>
        ) : null}
      </div>
    </nav>
  );

  if (banned) return <BannedAccount />;

  return (
    <PortalContext.Provider value={value}>
      <div className="ap" data-drawer={drawer ? "open" : undefined}>
        <div className="ap-bar">
          <button type="button" className="ap-icon-button" aria-label="Open the portal menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon node={Menu} />
          </button>
          <strong>{accountName}</strong>
          <Link href="/portal/campaigns/new" className="ap-bar-new" aria-label="New campaign"><Icon node={Plus} /></Link>
        </div>

        <aside className="ap-rail">{rail}</aside>

        {drawer && (
          <div className="ap-drawer" role="dialog" aria-modal="true" aria-label="Portal menu">
            <button type="button" className="ap-drawer-scrim" aria-label="Close the menu" onClick={() => setDrawer(false)} />
            <div className="ap-drawer-panel">
              <button type="button" className="ap-icon-button ap-drawer-close" aria-label="Close the menu" onClick={() => setDrawer(false)}>
                <Icon node={X} />
              </button>
              {rail}
            </div>
          </div>
        )}

        <div className="ap-main">{children}</div>
      </div>
    </PortalContext.Provider>
  );
}

/** The skeleton every portal page shows while the report loads, shaped like what arrives. */
export function PortalSkeleton() {
  return (
    <div className="ap-skeleton" aria-busy="true">
      <i className="ap-sk-title" />
      <div className="ap-sk-tiles"><i /><i /><i /><i /></div>
      <i className="ap-sk-panel" />
      <span className="sr-only">Loading your advertiser workspace</span>
    </div>
  );
}

/** The report did not load: say so, say why, and offer the retry. */
export function PortalError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="ap-state" role="alert">
      <span className="ap-state-icon"><Icon node={CircleAlert} /></span>
      <h2>Your campaigns didn&apos;t load</h2>
      <p>{message ?? "Something went wrong on our side."} Nothing has changed with your campaigns or credits.</p>
      <button type="button" className="ap-btn" onClick={onRetry}>Try again</button>
    </div>
  );
}
