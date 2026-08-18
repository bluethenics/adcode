/**
 * The report form: a bug, a feature request, or a question.
 *
 * Follows `promptDialog.ts` - a native `<dialog>`, every exit route converging on `close`
 * so a dismissal cannot leak the promise. The differences are that this one has more than
 * one field, and that it stays open while submitting: a form that vanishes the instant you
 * press the button leaves you unsure whether anything was sent.
 *
 * Nothing about the machine is collected here. The version and platform are added in the
 * main process, and the footer says so, because a dialog that quietly harvests context is
 * how people learn not to file reports.
 */
import type { ReportInput, ReportKind, ReportResult } from "../../shared/api.ts";

export interface ReportDialog {
  open(): void;
  isOpen(): boolean;
}

interface Choice {
  readonly kind: ReportKind;
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
}

const CHOICES: readonly Choice[] = [
  {
    kind: "bug",
    label: "Something is broken",
    hint: "Report a bug",
    placeholder: "What did you do, what happened, and what did you expect instead?",
  },
  {
    kind: "feature",
    label: "Something is missing",
    hint: "Suggest a feature",
    placeholder: "What would you like to be able to do?",
  },
  {
    kind: "help",
    label: "I am stuck",
    hint: "Ask for help",
    placeholder: "What are you trying to do?",
  },
  {
    kind: "other",
    label: "Something else",
    hint: "Anything else",
    placeholder: "Tell us what is on your mind.",
  },
];

const TITLE_MAX = 120;
const BODY_MAX = 4000;

export function createReportDialog(
  host: HTMLElement,
  submit: (input: ReportInput) => Promise<ReportResult>,
): ReportDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog report-dialog";

  const card = document.createElement("div");
  card.className = "result-card report-card";

  const title = document.createElement("h2");
  title.className = "result-title";
  title.textContent = "Send feedback";

  const form = document.createElement("form");
  form.className = "report-form";
  form.method = "dialog";

  /* ── Kind ─────────────────────────────────────────────────────────────── */

  const kinds = document.createElement("div");
  kinds.className = "report-kinds";
  kinds.setAttribute("role", "radiogroup");
  kinds.setAttribute("aria-label", "What kind of report is this?");

  let selected: Choice = CHOICES[0] as Choice;
  const kindButtons = new Map<ReportKind, HTMLButtonElement>();

  for (const choice of CHOICES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "report-kind";
    button.dataset["kind"] = choice.kind;
    button.setAttribute("role", "radio");

    const label = document.createElement("span");
    label.className = "report-kind-label";
    label.textContent = choice.label;

    const hint = document.createElement("span");
    hint.className = "report-kind-hint";
    hint.textContent = choice.hint;

    button.append(label, hint);
    button.addEventListener("click", () => select(choice));

    kinds.append(button);
    kindButtons.set(choice.kind, button);
  }

  /* ── Fields ───────────────────────────────────────────────────────────── */

  const summary = document.createElement("input");
  summary.className = "report-input";
  summary.type = "text";
  summary.maxLength = TITLE_MAX;
  summary.placeholder = "One line: what is this about?";
  summary.setAttribute("aria-label", "Summary");
  summary.setAttribute("autocomplete", "off");

  const detail = document.createElement("textarea");
  detail.className = "report-textarea";
  detail.maxLength = BODY_MAX;
  detail.rows = 7;
  detail.setAttribute("aria-label", "Details");

  const status = document.createElement("p");
  status.className = "report-status";
  status.setAttribute("role", "status");
  status.hidden = true;

  const footnote = document.createElement("p");
  footnote.className = "report-footnote";
  footnote.textContent =
    "Sends your message with the app version and your operating system. Never your files, paths, or project names.";

  /* ── Buttons ──────────────────────────────────────────────────────────── */

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";

  const cancel = document.createElement("button");
  cancel.className = "confirm-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";

  const send = document.createElement("button");
  send.className = "result-close";
  send.type = "submit";
  send.textContent = "Send";

  buttons.append(cancel, send);
  form.append(kinds, summary, detail, status, footnote, buttons);
  card.append(title, form);
  dialog.append(card);
  host.append(dialog);

  let sending = false;

  function select(choice: Choice): void {
    selected = choice;
    for (const [kind, button] of kindButtons) {
      const active = kind === choice.kind;
      button.setAttribute("aria-checked", active ? "true" : "false");
    }
    detail.placeholder = choice.placeholder;
  }

  function setStatus(message: string | null, tone: "error" | "ok" = "error"): void {
    status.textContent = message ?? "";
    status.hidden = message === null;
    status.dataset["tone"] = tone;
  }

  function reset(): void {
    select(CHOICES[0] as Choice);
    summary.value = "";
    detail.value = "";
    setStatus(null);
    sending = false;
    send.disabled = false;
    send.textContent = "Send";
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sending) return;

    const trimmedTitle = summary.value.trim();
    const trimmedBody = detail.value.trim();

    // Checked here as well as in the main process. The point is not defence - it is that
    // a message about an empty field should arrive without a round trip.
    if (trimmedTitle.length === 0) {
      setStatus("Add a one-line summary.");
      summary.focus();
      return;
    }
    if (trimmedBody.length === 0) {
      setStatus("Add some detail - even one sentence helps.");
      detail.focus();
      return;
    }

    sending = true;
    send.disabled = true;
    send.textContent = "Sending…";
    setStatus(null);

    void submit({ kind: selected.kind, title: trimmedTitle, body: trimmedBody }).then(
      (result) => {
        if (result.ok) {
          // Closing on success is the confirmation; a toast follows from the caller.
          dialog.close();
          return;
        }
        sending = false;
        send.disabled = false;
        send.textContent = "Send";
        setStatus(result.message);
      },
      () => {
        sending = false;
        send.disabled = false;
        send.textContent = "Send";
        setStatus("Something went wrong sending that. Try again.");
      },
    );
  });

  cancel.addEventListener("click", () => dialog.close());

  // Clicking the backdrop dismisses, but not mid-send: losing what you typed because you
  // missed the card by ten pixels is the kind of thing people do not forgive.
  dialog.addEventListener("click", (event) => {
    if (sending) return;
    if (!card.contains(event.target as Node)) dialog.close();
  });

  dialog.addEventListener("close", () => reset());

  reset();

  return {
    open() {
      if (dialog.open) return;
      reset();
      dialog.showModal();
      summary.focus();
    },
    isOpen: () => dialog.open,
  };
}
