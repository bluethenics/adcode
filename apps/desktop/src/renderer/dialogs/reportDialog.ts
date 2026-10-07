import { bindBackdropDismissal } from "./backdropDismissal.ts";

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

/** What to start the form with - the Help menu and a failed assistant turn both prefill it. */
export interface ReportPrefill {
  readonly kind?: ReportKind;
  readonly title?: string;
  readonly body?: string;
  /** Tick "Include debug log" from the start. The user can still untick it. */
  readonly includeDebugLog?: boolean;
}

export interface ReportDialog {
  open(prefill?: ReportPrefill): void;
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

const FOOTNOTE =
  "Sends your message with the app version and your operating system. Never your files, paths, or project names.";
const FOOTNOTE_WITH_LOG =
  "Sends your message, the app version, your operating system and the debug log above. Never your keys, files, paths, or project names.";

/** Keeps the debug log apart from what the user wrote, in the one text field the server takes. */
const LOG_DIVIDER = "\n\n--- Debug log ---\n";

export function createReportDialog(
  host: HTMLElement,
  submit: (input: ReportInput) => Promise<ReportResult>,
  /** The redacted debug log summary, at most `maxChars` long. Absent means no option. */
  debugSummary?: (maxChars: number) => Promise<string>,
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

  /*
   * The debug log option. Shown, not described: the summary that would be attached is
   * right there under the checkbox, so nobody has to take the footnote's word for it.
   */
  const logOption = document.createElement("div");
  logOption.className = "report-log";
  logOption.hidden = debugSummary === undefined;
  const logLabel = document.createElement("label");
  logLabel.className = "report-log-label";
  const logCheck = document.createElement("input");
  logCheck.type = "checkbox";
  logCheck.className = "report-log-check";
  const logText = document.createElement("span");
  logText.textContent = "Include debug log - recent errors, app version and the selected model";
  logLabel.append(logCheck, logText);
  const logPreview = document.createElement("details");
  logPreview.className = "report-log-preview";
  const logPreviewSummary = document.createElement("summary");
  logPreviewSummary.textContent = "See exactly what is included";
  const logPreviewText = document.createElement("pre");
  logPreviewText.className = "report-log-text";
  logPreview.append(logPreviewSummary, logPreviewText);
  logOption.append(logLabel, logPreview);
  let logSummary = "";
  const refreshLog = (): void => {
    if (debugSummary === undefined) return;
    const room = Math.max(0, BODY_MAX - detail.value.trim().length - LOG_DIVIDER.length);
    void debugSummary(Math.max(300, room)).then((text) => {
      logSummary = text;
      logPreviewText.textContent = text;
    }, () => { logSummary = ""; logPreviewText.textContent = "The debug log could not be read."; });
  };
  logCheck.addEventListener("change", () => {
    logPreview.hidden = !logCheck.checked;
    footnote.textContent = logCheck.checked ? FOOTNOTE_WITH_LOG : FOOTNOTE;
    if (logCheck.checked) refreshLog();
  });

  const status = document.createElement("p");
  status.className = "report-status";
  status.setAttribute("role", "status");
  status.hidden = true;

  const footnote = document.createElement("p");
  footnote.className = "report-footnote";
  footnote.textContent = FOOTNOTE;

  // No amount, and no promise: an award is a thank-you somebody decides on, not a bounty.
  const thanks = document.createElement("p");
  thanks.className = "report-footnote report-thanks";
  thanks.textContent = "Confirmed bugs and ideas we build can earn a thank-you in your ADCode balance.";

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
  form.append(kinds, summary, detail, logOption, status, footnote, thanks, buttons);
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

  function reset(prefill: ReportPrefill = {}): void {
    select(CHOICES.find((choice) => choice.kind === prefill.kind) ?? (CHOICES[0] as Choice));
    summary.value = (prefill.title ?? "").slice(0, TITLE_MAX);
    detail.value = (prefill.body ?? "").slice(0, BODY_MAX);
    logCheck.checked = prefill.includeDebugLog === true && debugSummary !== undefined;
    logPreview.hidden = !logCheck.checked;
    logPreview.open = false;
    footnote.textContent = logCheck.checked ? FOOTNOTE_WITH_LOG : FOOTNOTE;
    logSummary = "";
    if (logCheck.checked) refreshLog();
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

    // The log rides in the body, after what the user wrote, cut to whatever room is left.
    const withLog = logCheck.checked && logSummary.length > 0
      ? `${trimmedBody}${LOG_DIVIDER}${logSummary}`.slice(0, BODY_MAX)
      : trimmedBody;
    void submit({ kind: selected.kind, title: trimmedTitle, body: withLog }).then(
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
  bindBackdropDismissal(dialog, card, () => { if (!sending) dialog.close(); });

  dialog.addEventListener("close", () => reset());

  reset();

  return {
    open(prefill) {
      if (dialog.open) return;
      reset(prefill);
      dialog.showModal();
      (summary.value.length === 0 ? summary : detail).focus();
    },
    isOpen: () => dialog.open,
  };
}
