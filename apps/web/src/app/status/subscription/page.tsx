import type { Metadata } from "next";
import { DoneCard, type DoneRow } from "@/components/DoneCard";

/**
 * Where the status page's email form, and the links in its emails, land.
 *
 * One card that says what just happened, in the design every ADCode success page shares
 * (`components/DoneCard.tsx`). Confirming and unsubscribing are buttons that post, never
 * something a bare visit does: mail scanners open every link in an email, and a GET that
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
  rows?: DoneRow[];
  body: string;
  /** A form that posts the token, shown as the primary button. */
  post?: { action: string; token: string; label: string };
  back?: { href: string; label: string };
}

const SCREENS: Record<string, Screen> = {
  "check-email": {
    tone: "info",
    title: "Check your inbox",
    rows: [
      { label: "Sent from", value: "noreply@bluethenics.com" },
      { label: "Next step", value: "Click the button in that email" },
    ],
    body: "Nothing else is sent until you do. Not there in a minute? Look in spam or promotions.",
    back: { href: "/status", label: "Back to status" },
  },
  confirmed: {
    tone: "ok",
    title: "You're subscribed",
    rows: [
      { label: "Alerts", value: "Model health, plus incident updates if you chose them" },
      { label: "Unsubscribe", value: "One click, in every email" },
    ],
    body: "You'll get an email when an included model degrades or fails, and again when it's back to normal.",
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
    body: "It may have been used already, or copied only in part. If you are already subscribed, nothing has changed.",
    back: { href: "/status#subscribe", label: "Go to the form" },
  },
  unsubscribed: {
    tone: "ok",
    title: "You're unsubscribed",
    rows: [
      { label: "Status emails", value: "Stopped for this address" },
      { label: "Live status", value: "adcode.bluethenics.com/status" },
    ],
    body: "No more status emails will be sent to this address. Everything else stays as it is.",
    back: { href: "/status", label: "See live status" },
  },
  "invalid-email": {
    tone: "warn",
    title: "That email address doesn't look right",
    body: "Check it for a typo, something like name@example.com, and try again.",
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
      rows: [
        { label: "Alerts", value: "ADCode model health and incidents" },
        { label: "Unsubscribe", value: "One click, in every email" },
      ],
      body: "One click and this address is on the list. If you didn't ask for this, close this tab.",
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
      rows: [
        { label: "Stops", value: "Model health and incident emails" },
        { label: "Everything else", value: "Stays as it is" },
      ],
      body: "This address will no longer hear about models degrading, recovering, or incident updates.",
      post: { action: "/v1/status/unsubscribe", token: unsubscribe, label: "Stop status emails" },
      back: { href: "/status", label: "Keep them" },
    };
  }
  return SCREENS[one("state")] ?? SCREENS["check-email"]!;
}

export default async function StatusSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = screenFor(await searchParams);
  return (
    <DoneCard
      tone={screen.tone}
      title={screen.title}
      {...(screen.rows !== undefined ? { rows: screen.rows } : {})}
      notes={[screen.body]}
      {...(screen.post !== undefined
        ? { action: { kind: "post" as const, label: screen.post.label, action: screen.post.action, fields: { token: screen.post.token } }, ...(screen.back !== undefined ? { secondary: screen.back } : {}) }
        : screen.back !== undefined ? { action: { kind: "link" as const, ...screen.back } } : {})}
    />
  );
}
