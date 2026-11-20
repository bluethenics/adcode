/**
 * "Convert to AI credits", inside the earnings card.
 *
 * One confirmed step: the panel shows what is available and what the typed amount buys,
 * and the Convert button - which names both amounts - is the confirmation. The server
 * quotes the rate, the limits and both balances, and does the move in one transaction;
 * this panel only reads the quote and sends an amount with a request id
 * (shared/creditConversion.ts says why nothing it computes is sent back).
 *
 * The request id is chosen when somebody clicks Convert and kept until the amount changes
 * or the conversion lands, so "Try again" after a lost answer repeats the *same* request,
 * which the server answers "already done" instead of paying twice.
 */
import { createConversionDialog, type ConversionFigures } from "./conversionDialog.ts";
import {
  blockedMessage,
  creditsAtRate,
  conversionErrorMessage,
  dollarInputText,
  formatUsd,
  previewConversion,
  type CreditConversionQuote,
} from "../../shared/creditConversion.ts";

export interface CreditConversionPanelDeps {
  /** After a conversion lands: the earnings card reads its balance again. */
  readonly onConverted: () => void;
  /** Hides the panel; the card's own Convert button shows it again. */
  readonly onClose: () => void;
}

export interface CreditConversionPanel {
  readonly element: HTMLElement;
  /** The confirm/done pop-up layer; the card mounts it over itself. */
  readonly dialogElement: HTMLElement;
  /** Shows the panel and asks the server for a fresh quote. */
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const newRequestId = (): string => crypto.randomUUID();

export function createCreditConversionPanel(deps: CreditConversionPanelDeps): CreditConversionPanel {
  const panel = document.createElement("section");
  panel.className = "earnings-convert";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "earnings-convert-title");

  const title = document.createElement("h3");
  title.className = "earnings-convert-title";
  title.id = "earnings-convert-title";
  title.textContent = "Convert to AI credits";

  const intro = document.createElement("p");
  intro.className = "earnings-convert-intro";
  intro.textContent = "Spend earnings on paid AI models right away, without withdrawing. Credits never expire.";

  const facts = document.createElement("dl");
  facts.className = "earnings-convert-facts";
  const fact = (label: string): HTMLElement => {
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.textContent = "—";
    facts.append(term, value);
    return value;
  };
  const availableValue = fact("Earnings you can convert");
  const creditValue = fact("Your AI credits now");
  const rateValue = fact("Rate");

  const field = document.createElement("div");
  field.className = "ad-field earnings-convert-field";
  const label = document.createElement("label");
  label.htmlFor = "earnings-convert-amount";
  label.textContent = "Amount in US dollars";
  const inputRow = document.createElement("div");
  inputRow.className = "earnings-convert-input-row";
  const input = document.createElement("input");
  input.id = "earnings-convert-amount";
  input.className = "ad-input";
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "0.00";
  input.setAttribute("aria-describedby", "earnings-convert-preview");
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "ad-btn ad-btn-tertiary";
  allButton.textContent = "All";
  allButton.setAttribute("aria-label", "Convert all I can");
  inputRow.append(input, allButton);
  field.append(label, inputRow);

  const preview = document.createElement("p");
  preview.className = "earnings-convert-preview";
  preview.id = "earnings-convert-preview";
  preview.setAttribute("role", "status");

  const actions = document.createElement("div");
  actions.className = "earnings-convert-actions";
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "ad-btn ad-btn-primary";
  confirmButton.textContent = "Convert";
  confirmButton.disabled = true;
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ad-btn ad-btn-tertiary";
  cancelButton.textContent = "Cancel";
  actions.append(confirmButton, cancelButton);

  panel.append(title, intro, facts, field, preview, actions);

  let quote: CreditConversionQuote | null = null;
  let busy = false;
  /** Kept across retries of one confirmation; cleared when the amount changes or it lands. */
  let requestId: string | null = null;
  let loadGeneration = 0;
  const dialog = createConversionDialog();

  function setFormEnabled(enabled: boolean): void {
    input.disabled = !enabled;
    allButton.disabled = !enabled;
    if (!enabled) confirmButton.disabled = true;
  }

  function renderPreview(): void {
    if (quote === null) return;
    const result = previewConversion(quote, input.value);
    input.setAttribute("aria-invalid", String(!result.ok && input.value.trim() !== ""));
    delete preview.dataset["tone"];
    if (result.ok) {
      preview.textContent = `You get ${result.creditLabel} in AI credits. ${result.amountLabel} comes off your withdrawable earnings.`;
      confirmButton.textContent = `Convert ${result.amountLabel} to ${result.creditLabel} credits`;
      confirmButton.disabled = busy;
    } else {
      preview.textContent = result.message;
      if (input.value.trim() !== "") preview.dataset["tone"] = "warning";
      confirmButton.textContent = "Convert";
      confirmButton.disabled = true;
    }
  }

  function showQuote(next: CreditConversionQuote): void {
    quote = next;
    availableValue.textContent = next.blocked === null
      ? `${formatUsd(next.availableMicros)} · up to ${formatUsd(next.convertibleMaxMicros)} now`
      : formatUsd(next.availableMicros);
    creditValue.textContent = formatUsd(next.creditBalanceMicros);
    rateValue.textContent = next.rate.earningsMicros === next.rate.creditMicros
      ? "$1.00 of earnings = $1.00 of credits"
      : `${formatUsd(next.rate.earningsMicros)} of earnings = ${formatUsd(next.rate.creditMicros)} of credits`;
    if (next.blocked !== null) {
      setFormEnabled(false);
      preview.textContent = blockedMessage(next.blocked, next);
      preview.dataset["tone"] = "warning";
      return;
    }
    setFormEnabled(true);
    renderPreview();
  }

  async function loadQuote(): Promise<void> {
    const mine = ++loadGeneration;
    quote = null;
    setFormEnabled(false);
    delete preview.dataset["tone"];
    preview.textContent = "Checking your balances…";
    const result = await window.adcode.ads.conversionQuote().catch(() => ({ ok: false as const, reason: "offline" as const }));
    if (mine !== loadGeneration) return;
    if (!result.ok) {
      preview.textContent = result.reason === "signed-out"
        ? "Sign in to convert earnings to AI credits."
        : "Could not reach ADCode just now. Close this and try again.";
      preview.dataset["tone"] = "warning";
      return;
    }
    showQuote(result.quote);
  }

  input.addEventListener("input", () => {
    requestId = null;
    renderPreview();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !confirmButton.disabled) {
      event.preventDefault();
      confirmButton.click();
    }
  });
  allButton.addEventListener("click", () => {
    if (quote === null) return;
    input.value = dollarInputText(quote.convertibleMaxMicros);
    requestId = null;
    renderPreview();
    input.focus();
  });
  cancelButton.addEventListener("click", () => deps.onClose());

  /*
   * Convert opens the confirmation pop-up; nothing is sent until it is confirmed there.
   * The pop-up then stays up through converting, and plays the done or failed state.
   */
  confirmButton.addEventListener("click", () => void runConversion());

  async function runConversion(): Promise<void> {
    if (quote === null || busy) return;
    const draft = previewConversion(quote, input.value);
    if (!draft.ok) return;
    const amount = BigInt(draft.amountMicros);
    const projected: ConversionFigures = {
      amountLabel: draft.amountLabel,
      creditLabel: draft.creditLabel,
      earningsBeforeMicros: quote.availableMicros,
      earningsAfterMicros: (BigInt(quote.availableMicros) - amount).toString(),
      creditsBeforeMicros: quote.creditBalanceMicros,
      creditsAfterMicros: (BigInt(quote.creditBalanceMicros) + creditsAtRate(quote, amount)).toString(),
    };

    busy = true;
    if (!(await dialog.confirm(projected))) {
      busy = false;
      dialog.close();
      confirmButton.focus();
      return;
    }
    requestId ??= newRequestId();
    const request = { requestId, amountMicros: draft.amountMicros };
    panel.setAttribute("aria-busy", "true");
    setFormEnabled(false);

    for (;;) {
      dialog.converting();
      const outcome = await window.adcode.ads
        .convertToCredits(request)
        .catch(() => ({ ok: false as const, error: "offline", retryable: true }));

      if (outcome.ok) {
        requestId = null;
        input.value = "";
        const before = quote;
        // The answer carries both new balances: the panel shows them at once.
        showQuote({ ...before, availableMicros: outcome.availableMicros, creditBalanceMicros: outcome.creditBalanceMicros });
        deps.onConverted();
        await dialog.succeeded({
          amountLabel: formatUsd(outcome.earningsMicros),
          creditLabel: formatUsd(outcome.creditMicros),
          // A replay's "before" is the quote this panel showed; the "after" is always the server's.
          earningsBeforeMicros: before.availableMicros,
          earningsAfterMicros: outcome.availableMicros,
          creditsBeforeMicros: before.creditBalanceMicros,
          creditsAfterMicros: outcome.creditBalanceMicros,
        });
        dialog.close();
        busy = false;
        panel.setAttribute("aria-busy", "false");
        preview.textContent = `Done: ${formatUsd(outcome.earningsMicros)} of earnings became ${formatUsd(outcome.creditMicros)} in AI credits.`;
        preview.dataset["tone"] = "success";
        void loadQuote().then(() => {
          preview.textContent = `Done: ${formatUsd(outcome.earningsMicros)} of earnings became ${formatUsd(outcome.creditMicros)} in AI credits.`;
          preview.dataset["tone"] = "success";
        });
        return;
      }

      // Nothing moved. A retryable failure keeps the request id, so "Try again" repeats the
      // same request and can never pay twice.
      const choice = await dialog.failed(conversionErrorMessage(outcome.error), outcome.retryable);
      if (choice === "retry") continue;
      if (!outcome.retryable) requestId = null;
      dialog.close();
      busy = false;
      panel.setAttribute("aria-busy", "false");
      void loadQuote().then(() => {
        input.value = dollarInputText(request.amountMicros);
        renderPreview();
      });
      return;
    }
  }

  return {
    element: panel,
    dialogElement: dialog.element,
    open(): void {
      panel.hidden = false;
      input.value = "";
      requestId = null;
      // The box is disabled until the quote arrives, so focus waits for it too.
      void loadQuote().then(() => {
        if (!panel.hidden && !input.disabled) input.focus();
      });
    },
    close(): void {
      dialog.close();
      panel.hidden = true;
      loadGeneration += 1;
    },
    isOpen: () => !panel.hidden,
  };
}
