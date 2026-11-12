/**
 * Phone link: the switch, the code a phone scans, and who is connected.
 *
 * main/phoneLink.ts keeps the connection; this is the door into it. The QR code opens the
 * phone page; the phone signs in with the same account and finds this computer by itself, so
 * there is no pairing code to read out or type.
 */
import type { PhoneLinkStateView } from "../../shared/api.ts";
import { encodeQr, qrSvg } from "../../shared/qrCode.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";
import { createAdcodeMascot, type AdcodeMascotMood } from "../mascot/adcodeMascot.ts";

const STATUS_WORDS: Record<PhoneLinkStateView["status"], string> = {
  off: "Off",
  connecting: "Connecting",
  online: "Ready",
  offline: "Reconnecting",
  "signed-out": "Sign in needed",
  unsupported: "Desktop only",
};

const MOOD: Record<PhoneLinkStateView["status"], AdcodeMascotMood> = {
  off: "sleeping",
  connecting: "connecting",
  online: "greeting",
  offline: "searching",
  "signed-out": "surprised",
  unsupported: "idle",
};

const ago = (since: number): string => {
  const minutes = Math.round((Date.now() - since) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

/** The status bar's words, or null when Phone link is off. */
export function phoneChipText(state: PhoneLinkStateView): string | null {
  if (!state.enabled) return null;
  if (state.status === "online" && state.phones.length > 0) return state.phones.length === 1 ? "Phone connected" : `${state.phones.length} phones connected`;
  return `Phone link: ${STATUS_WORDS[state.status].toLowerCase()}`;
}

export async function openPhoneLinkDialog(): Promise<void> {
  let state = await window.adcode.phone.state();
  return new Promise((resolve) => {
    const { card, dialog, finish } = openFormModal("phone-link-dialog", "Phone link", () => { stop(); resolve(); });
    const buck = createAdcodeMascot({ mood: MOOD[state.status], size: 64, interactive: true });
    const lead = el("p", "result-summary phone-lead", "Chat with ADCode on this computer from your phone. This computer does the work with your projects, keys and tools - your phone only sends messages and sees the replies.");

    const head = el("div", "phone-head");
    const toggle = el("label", "ad-switch phone-toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    toggle.append(input, document.createTextNode(" Let my phone chat with this computer"));
    const status = el("p", "phone-status");
    status.setAttribute("aria-live", "polite");
    const copy = el("div", "phone-head-copy");
    copy.append(toggle, status);
    head.append(buck.element, copy);

    const scan = el("div", "phone-scan");
    /* The code opens the page pointed at this computer: scan, sign in, chat - no list to pick from. */
    const qrFigure = el("figure", "phone-qr-figure");
    const qr = el("div", "phone-qr");
    let drawn = "";
    const drawQr = (): void => {
      const target = state.pairUrl || state.pageUrl;
      if (target === drawn) return;
      drawn = target;
      const code = encodeQr(target);
      qr.innerHTML = code === null ? "" : qrSvg(code, { dark: "#111110", light: "#ffffff", label: "QR code: open Phone link on your phone" });
    };
    qrFigure.append(qr, el("figcaption", "phone-qr-caption", "Point your phone's camera here"));
    const steps = el("ol", "phone-steps");
    for (const text of [
      "Scan the code with your phone's camera, or open the link below. It opens this computer.",
      "Sign in with the same account you use here.",
      "Chat. Add the page to your home screen to use it like an app.",
    ]) steps.append(el("li", "", text));
    const link = el("div", "phone-link-row");
    const url = el("code", "phone-url", state.pageUrl.replace(/^https:\/\//, ""));
    const copyButton = button("Copy link", "ghost-button", () => {
      void navigator.clipboard.writeText(state.pairUrl || state.pageUrl).then(() => {
        copyButton.textContent = "Copied";
        window.setTimeout(() => { copyButton.textContent = "Copy link"; }, 1400);
      });
    });
    link.append(url, copyButton);
    const stepsColumn = el("div", "phone-steps-column");
    stepsColumn.append(steps, link);
    scan.append(qrFigure, stepsColumn);

    const phonesTitle = el("h3", "phone-subtitle", "Connected phones");
    const phones = el("ul", "phone-list");
    const caveat = el("p", "phone-note", "Your computer has to be on, awake and online - it is the one doing the work. Pair it with When the assistant finishes to let it sleep once your phone's task is done; it can't be woken from the phone.");
    const actions = el("div", "power-actions");
    const done = button("Done", "ad-btn ad-btn-primary", () => finish());
    actions.append(done);

    card.append(lead, head, scan, phonesTitle, phones, caveat, actions);

    const paint = (): void => {
      input.checked = state.enabled;
      input.disabled = state.status === "unsupported";
      card.dataset["status"] = state.status;
      status.textContent = state.status === "off" ? "Off. Nothing can reach this computer." : `${STATUS_WORDS[state.status]}. ${state.detail}`;
      buck.setMood(MOOD[state.status]);
      if (state.enabled) drawQr();
      scan.hidden = !state.enabled;
      phonesTitle.hidden = !state.enabled;
      phones.hidden = !state.enabled;
      phones.replaceChildren();
      if (state.phones.length === 0) phones.append(el("li", "phone-empty", "No phone yet."));
      for (const phone of state.phones) {
        const row = el("li", "phone-row");
        const words = el("span", "phone-row-copy");
        words.append(el("strong", "", phone.label), el("small", "", `Connected ${ago(phone.since)}`));
        row.append(words, button("Disconnect", "ghost-button", () => void window.adcode.phone.disconnect(phone.id)));
        phones.append(row);
      }
    };
    input.addEventListener("change", () => {
      input.disabled = true;
      void window.adcode.phone.setEnabled(input.checked).then((next) => {
        state = next;
        paint();
        if (next.enabled) {
          buck.play("celebrating", 1400);
          // The code is the next thing to do: bring it into view in a short window.
          requestAnimationFrame(() => scan.scrollIntoView({ block: "nearest", behavior: "smooth" }));
        }
      }).finally(() => { input.disabled = state.status === "unsupported"; });
    });
    const stop = window.adcode.phone.onChanged((next) => {
      const joined = next.phones.length > state.phones.length;
      state = next;
      paint();
      if (joined) buck.play("dancing", 1600);
    });
    dialog.addEventListener("close", () => buck.destroy(), { once: true });
    paint();
    dialog.showModal();
    input.focus();
  });
}
