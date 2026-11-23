import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ADCODE_ICON_SVG, DONE_CARD_CSS, type DoneRow, type DoneTone } from "@adcode/api/src/doneCard.ts";

export { maskEmail } from "@adcode/api/src/doneCard.ts";
export type { DoneRow } from "@adcode/api/src/doneCard.ts";

/**
 * The website's "it's done" card: signed in, connected, verified, paid, subscribed.
 *
 * The same markup and the same stylesheet as the pages the API and the desktop app serve
 * (`services/api/src/doneCard.ts` owns both), so a person who lands on any of them sees one
 * design. React-only additions are the things a static page cannot do: a button that runs
 * code, a busy state, an error line, and the overlay a checkout return opens over its page.
 *
 * The site layout already owns <main>, so this is a <div>; the standalone pages use <main>.
 *
 * No hooks and no "use client": a server page (status alerts) renders it with links and
 * forms, a client page (sign-in, checkout returns) with `onClick`.
 */
export type DoneCardAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "post"; label: string; action: string; fields?: Readonly<Record<string, string>> }
  | { kind: "button"; label: ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean };

export type DoneCardSecondary = { label: string; href: string } | { label: string; onClick: () => void };

export interface DoneCardProps {
  title: string;
  rows?: readonly DoneRow[];
  notes?: readonly ReactNode[];
  action?: DoneCardAction;
  secondary?: DoneCardSecondary;
  tone?: DoneTone;
  /** A failure to show above the button, announced to screen readers. */
  alert?: ReactNode;
  /** Small links under everything (privacy, terms). */
  footer?: ReactNode;
  /** Draw over the page it opens on, rather than as the page. */
  overlay?: boolean;
  /** Announce the card when it appears (checkout returns arrive without a page load). */
  live?: boolean;
}

export function DoneCard({ title, rows = [], notes = [], action, secondary, tone = "ok", alert, footer, overlay = false, live = false }: DoneCardProps) {
  const card = (
    <div className="done-page" data-tone={tone} data-overlay={overlay ? "" : undefined}>
      {/* React hoists this into <head> once, however many cards a page renders. */}
      <style href="adcode-done-card" precedence="default">{DONE_CARD_CSS}</style>
      <section className="done-card" aria-labelledby="done-title" role={overlay ? "dialog" : undefined} aria-modal={overlay ? true : undefined} aria-live={live ? "polite" : undefined}>
        <span className="done-icon" dangerouslySetInnerHTML={{ __html: ADCODE_ICON_SVG }} />
        <h1 className="done-title" id="done-title">{title}</h1>
        {rows.length > 0 && (
          <dl className="done-rows">
            {rows.map((row) => (
              <div className="done-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {notes.map((note, index) => <p className="done-note" key={index}>{note}</p>)}
        {alert !== undefined && alert !== null && alert !== false && <p className="done-alert" role="alert">{alert}</p>}
        {(action !== undefined || secondary !== undefined) && (
          <div className="done-actions">
            {action !== undefined && <Action action={action} />}
            {secondary !== undefined && ("href" in secondary
              ? <a className="done-secondary" href={secondary.href}>{secondary.label}</a>
              : <button type="button" className="done-secondary" onClick={secondary.onClick}>{secondary.label}</button>)}
          </div>
        )}
        {footer !== undefined && <p className="done-footer">{footer}</p>}
      </section>
    </div>
  );
  // An overlay goes straight into <body>: a transformed or contained ancestor (the advertiser
  // portal has one) would otherwise become the box "position: fixed" fills. Overlays only ever
  // open after hydration, so there is always a document here.
  return overlay && typeof document !== "undefined" ? createPortal(card, document.body) : card;
}

function Action({ action }: { action: DoneCardAction }) {
  if (action.kind === "link") return <a className="done-button" href={action.href}>{action.label}</a>;
  if (action.kind === "post") {
    return (
      <form method="post" action={action.action}>
        {Object.entries(action.fields ?? {}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <button type="submit" className="done-button">{action.label}</button>
      </form>
    );
  }
  return (
    <button type="button" className="done-button" disabled={action.disabled === true || action.busy === true} aria-busy={action.busy === true ? true : undefined} onClick={action.onClick}>
      {action.busy === true && <span className="done-spinner" aria-hidden="true" />}
      {action.label}
    </button>
  );
}
