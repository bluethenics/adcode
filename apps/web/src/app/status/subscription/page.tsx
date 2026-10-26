import type { Metadata } from "next";
import "../status.css";

/**
 * Where the status page's email form, and the links in its emails, land.
 *
 * One card that says what just happened. Confirming and unsubscribing are buttons that post,
 * never something a bare visit does: mail scanners open every link in an email, and a GET that
 * confirmed would sign people up - or off - without them. Like /status, no client script.
 */
export const metadata: Metadata = {
  title: "Status alerts",
  robots: { index: false, follow: false },
};

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tone = "ok" | "warn" | "info";

interface Screen {
  tone: Tone;
  title: string;
  body: string;
  /** A form that posts the token, shown as the primary button. */
  post?: { action: string; token: string; label: string };
  back?: { href: string; label: string };
}

const SCREENS: Record<string, Screen> = {
  "check-email": {
    tone: "info",
    title: "Check your inbox",
    body: "If that address can receive alerts, a confirmation email from noreply@bluethenics.com is on its way. Click the button in it and you are set. Nothing else is sent until you do. Not there in a minute? Look in spam or promotions.",
    back: { href: "/status", label: "Back to status" },
  },
  confirmed: {
    tone: "ok",
    title: "You're subscribed",
    body: "You will get an email when an included model degrades or fails, and again when it is back to normal - plus incident updates if you chose them. Every email has a one-click unsubscribe.",
    back: { href: "/status", label: "See live status" },
  },
  expired: {
    tone: "warn",
    title: "That link has expired",
    body: "Confirmation links work for seven days. Enter your address again and we will send a fresh one.",
    back: { href: "/status#subscribe", label: "Subscribe again" },
  },
  invalid: {
    tone: "warn",
    title: "That link doesn't work",
    body: "It may have been used already, or copied only in part. If you are already subscribed, nothing has changed. To start over, enter your address on the status page.",
    back: { href: "/status#subscribe", label: "Go to the form" },
  },
  unsubscribed: {
    tone: "ok",
    title: "You're unsubscribed",
    body: "No more status emails will be sent to this address. The live status of every model is always at adcode.bluethenics.com/status.",
    back: { href: "/status", label: "See live status" },
  },
  "invalid-email": {
    tone: "warn",
    title: "That email address doesn't look right",
    body: "Check it for a typo - something like name@example.com - and try again.",
    back: { href: "/status#subscribe", label: "Try again" },
  },
  "no-topic": {
    tone: "warn",
    title: "Pick at least one kind of alert",
    body: "Tick model health, incident updates, or both, so we know what to email you about.",
    back: { href: "/status#subscribe", label: "Try again" },
  },
  busy: {
    tone: "warn",
    title: "Too many tries just now",
    body: "To keep the form from being used to email strangers, each network gets a few tries every ten minutes. Wait a few minutes and try again.",
    back: { href: "/status#subscribe", label: "Back to the form" },
  },
  unavailable: {
    tone: "warn",
    title: "Alerts are unavailable right now",
    body: "The service behind them is not answering. It is usually back within minutes; the status page itself keeps working.",
    back: { href: "/status", label: "Back to status" },
  },
};

function screenFor(params: Record<string, string | string[] | undefined>): Screen {
  const one = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
  const confirm = one("confirm");
  if (confirm !== "") {
    if (!TOKEN.test(confirm)) return SCREENS["invalid"]!;
    return {
      tone: "info",
      title: "Confirm your status alerts",
      body: "One click and this address is on the list. You can unsubscribe from any alert with one click.",
      post: { action: "/v1/status/confirm", token: confirm, label: "Confirm my alerts" },
      back: { href: "/status", label: "Not now" },
    };
  }
  const unsubscribe = one("unsubscribe");
  if (unsubscribe !== "") {
    if (!TOKEN.test(unsubscribe)) return SCREENS["invalid"]!;
    return {
      tone: "info",
      title: "Stop status emails?",
      body: "This address will no longer hear about models degrading, recovering, or incident updates. Everything else stays as it is.",
      post: { action: "/v1/status/unsubscribe", token: unsubscribe, label: "Stop status emails" },
      back: { href: "/status", label: "Keep them" },
    };
  }
  return SCREENS[one("state")] ?? SCREENS["check-email"]!;
}

function Mark({ tone }: { tone: Tone }) {
  return (
    <span className="status-subscription-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tone === "ok" ? <path d="M4.5 10.5l3.5 3.5 7.5-8" /> : tone === "warn" ? <path d="M10 5.5v5.5M10 14.5v.01" /> : <path d="M3.5 6.5l6.5 4.5 6.5-4.5M3.5 6v8.5h13V6" />}
      </svg>
    </span>
  );
}

export default async function StatusSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = screenFor(await searchParams);
  return (
    <section className="public-glass-page status-page">
      <div className="marketplace-wrap">
        <article className="status-subscription" data-tone={screen.tone} role="status">
          <Mark tone={screen.tone} />
          <h1>{screen.title}</h1>
          <p>{screen.body}</p>
          <div className="status-subscription-actions">
            {screen.post !== undefined && (
              <form method="post" action={screen.post.action}>
                <input type="hidden" name="token" value={screen.post.token} />
                <button type="submit" className="is-primary">{screen.post.label}</button>
              </form>
            )}
            {screen.back !== undefined && (
              <a href={screen.back.href} className={screen.post === undefined ? "is-primary" : undefined}>{screen.back.label}</a>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
