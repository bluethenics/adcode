"use client";

import { ACCOUNT_BANNED_COPY, appealMailto } from "@adcode/help/accountBan";
import { useAuth } from "@/components/AuthProvider";
import { signOutNow } from "@/lib/firebase";

/**
 * What every signed-in page shows a banned account, in place of the page.
 *
 * The API refuses the account on every request already (services/api/src/accountBan.ts); this
 * is what turns that refusal into a sentence instead of "Something in that form wasn't
 * accepted" on each panel. The same words as the desktop app and the web version
 * (packages/help/src/accountBan.ts). Sign out stays offered here, unlike in the app: a website
 * is often a shared browser, and the next person must be able to sign in as themselves.
 */
export function BannedAccount() {
  const { user, retryAdmin, adminLoading } = useAuth();
  return (
    <section className="auth-screen" data-testid="account-banned">
      <div className="wrap">
        <div className="banned-account" role="alert" aria-labelledby="banned-title">
          <span className="banned-account-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
          </span>
          <h1 id="banned-title">{ACCOUNT_BANNED_COPY.title}</h1>
          <p>{ACCOUNT_BANNED_COPY.message}</p>
          <p className="banned-account-kept">{ACCOUNT_BANNED_COPY.kept}</p>
          {user !== null && <p className="banned-account-id">Account <code className="mono">{user.email ?? user.uid}</code></p>}
          <div className="banned-account-actions">
            <a className="btn btn-primary" href={appealMailto(user?.uid ?? null)}>{ACCOUNT_BANNED_COPY.emailSupport}</a>
            <button type="button" className="btn btn-outline" onClick={retryAdmin} disabled={adminLoading}>
              {adminLoading ? "Checking…" : ACCOUNT_BANNED_COPY.checkAgain}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void signOutNow()}>Sign out</button>
          </div>
        </div>
      </div>
    </section>
  );
}
