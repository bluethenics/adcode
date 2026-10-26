/**
 * The admin panel's page furniture, shared by every section.
 *
 * Most admin pages do the same two things: write something (an incident, a notice, a release
 * note, an appointment) and look at what is already there. They used to do both in one long
 * column - a form capped at 560px, a bold 18px heading typed inline, then the list - so on a
 * laptop half the screen sat empty and the list started below the fold. `AdminWorkspace` puts
 * the form beside the list it feeds, and `AdminPanel` gives every block the same titled card,
 * so a page reads as a few labelled things rather than a scroll of headings.
 *
 * Plain markup with no state, so a server or client section can use either.
 */
import type { FormEventHandler, ReactNode } from "react";

interface PanelProps {
  title: string;
  /** One sentence under the title: what this block is for. */
  hint?: ReactNode;
  /** Buttons or a count, at the right of the title. */
  actions?: ReactNode;
  /** A form panel posts on submit; anything else is a section. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Drop the card frame, for a panel whose content brings its own (a list of cards). */
  bare?: boolean;
  id?: string;
  children: ReactNode;
}

export function AdminPanel({ title, hint, actions, onSubmit, bare = false, id, children }: PanelProps) {
  const headingId = id === undefined ? undefined : `${id}-heading`;
  const head = (
    <header className="adm-panel-head">
      <div>
        <h2 id={headingId}>{title}</h2>
        {hint !== undefined && <p>{hint}</p>}
      </div>
      {actions !== undefined && <div className="adm-panel-actions">{actions}</div>}
    </header>
  );
  const className = bare ? "adm-panel adm-panel-bare" : "adm-panel";
  if (onSubmit !== undefined) {
    return (
      <form className={className} onSubmit={onSubmit} id={id} aria-labelledby={headingId}>
        {head}
        {children}
      </form>
    );
  }
  return (
    <section className={className} id={id} aria-labelledby={headingId}>
      {head}
      {children}
    </section>
  );
}

/**
 * A form and the list it adds to, side by side from 1100px, stacked below. The form column
 * stays in view while the list scrolls, so writing the next one never means scrolling back up.
 */
export function AdminWorkspace({ compose, children, editor = false }: {
  compose: ReactNode;
  children: ReactNode;
  /** A long-form editor (markdown with its preview): the editor takes the wide column. */
  editor?: boolean;
}) {
  return (
    <div className={editor ? "adm-workspace adm-workspace-editor" : "adm-workspace"}>
      <div className="adm-workspace-compose">{compose}</div>
      <div className="adm-workspace-list">{children}</div>
    </div>
  );
}

/** A row of headline figures at the top of a page: what is in this list, at a glance. */
export function AdminSummary({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "ok" | "bad" }[] }) {
  return (
    <dl className="adm-summary">
      {items.map((item) => (
        <div key={item.label} data-tone={item.tone}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.hint !== undefined && <p>{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/** The line under a list that says what it is not showing, or a rule worth knowing. */
export function AdminFootnote({ children }: { children: ReactNode }) {
  return <p className="adm-footnote">{children}</p>;
}
