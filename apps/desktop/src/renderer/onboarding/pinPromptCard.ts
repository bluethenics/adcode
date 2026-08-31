/**
 * "Would you like ADCode on your taskbar?" - asked once, after the tour, and at most once
 * more.
 *
 * Deliberately not a step in the onboarding sheet. A modal covers the taskbar it is asking
 * you to look at, and the tour's whole premise is that a new install shows no wall - a
 * fifth question would be one more thing between somebody and the editor they just
 * downloaded. So this is a card in the corner, in the same visual language as the release
 * note, that can be ignored into oblivion.
 *
 * Whether to ask at all is main's decision (`main/pinPromptPolicy.ts`, which also explains
 * why Windows and macOS get instructions where Linux gets a button). This file receives an
 * offer and draws it, and the only rule it owns is the one main cannot see: never over the
 * top of a release note. Two cards in one corner is a stack, and the note is the one with
 * something time-sensitive to say.
 */
import { reveal } from "../motion.ts";
import type { PinPromptContentView } from "../../shared/api.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

const ENTER_MS = 220;
const EXIT_MS = 160;
/** How long a successful pin's confirmation stays up before the card leaves by itself. */
const CONFIRM_MS = 2_200;

export interface PinPromptCard {
  /** Ask, if main says to. Safe to call more than once - the tour closes twice. */
  offer(): void;
  dismiss(): void;
}

export function createPinPromptCard(host: HTMLElement): PinPromptCard {
  let live: HTMLElement | null = null;
  let asked = false;

  function close(): void {
    const element = live;
    if (element === null) return;
    live = null;

    element.style.willChange = "transform, opacity";
    reveal(element, "exiting");
    window.setTimeout(() => element.remove(), EXIT_MS);
  }

  function draw(content: PinPromptContentView): void {
    const card = document.createElement("section");
    card.className = "pin-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", content.title);

    const head = document.createElement("header");
    head.className = "pin-card-head";

    const badge = document.createElement("span");
    badge.className = "pin-card-badge";
    badge.textContent = "One last thing";

    // Dismissal without an answer. Not the same as "don't ask again", and deliberately so:
    // closing a card is a reflex, and treating a reflex as a decision is how software ends
    // up never mentioning something again that the person never actually read.
    const dismiss = iconButton("Dismiss", ICON.close, "icon-button pin-card-dismiss");
    dismiss.addEventListener("click", close);

    head.append(badge, dismiss);

    const title = document.createElement("h2");
    title.className = "pin-card-title";
    title.textContent = content.title;

    const body = document.createElement("p");
    body.className = "pin-card-body";
    body.textContent = content.body;

    const steps = document.createElement("ol");
    steps.className = "pin-card-steps";
    steps.hidden = true;
    for (const step of content.steps) {
      const item = document.createElement("li");
      item.textContent = step;
      steps.append(item);
    }

    // Where a failed pin, or a successful one, gets to say so. Empty and hidden until then
    // rather than absent, so revealing it cannot reflow the card out from under a cursor.
    const status = document.createElement("p");
    status.className = "pin-card-status";
    status.hidden = true;
    status.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "pin-card-actions";

    const never = document.createElement("button");
    never.type = "button";
    never.className = "pin-card-never";
    never.textContent = "Don't ask again";
    never.addEventListener("click", () => {
      void window.adcode.pinPrompt.settle();
      close();
    });

    const later = document.createElement("button");
    later.type = "button";
    later.className = "pin-card-later";
    later.textContent = "Not now";
    later.addEventListener("click", close);

    const primary = document.createElement("button");
    primary.type = "button";
    primary.className = "pin-card-primary";

    function showSteps(): void {
      steps.hidden = false;
      // The instructions are on screen; the only thing left to say is that you are done
      // with them, and saying so closes the question for good.
      primary.textContent = "Done";
      primary.onclick = (): void => {
        void window.adcode.pinPrompt.settle();
        close();
      };
    }

    if (content.pinLabel !== null) {
      primary.textContent = content.pinLabel;
      primary.onclick = (): void => {
        primary.disabled = true;
        void window.adcode.pinPrompt.pin().then((result) => {
          // Text before visibility: a live region that becomes visible while still empty
          // announces nothing, and then announces a change nobody was waiting for.
          status.textContent = result.message;
          status.hidden = false;

          if (result.ok) {
            // Settled by main on success. The card lingers just long enough to be read.
            window.setTimeout(close, CONFIRM_MS);
            return;
          }

          // It could not be done for them, so tell them how to do it themselves. This is
          // the only path on which the button and the instructions are both on screen.
          primary.disabled = false;
          showSteps();
        });
      };
    } else {
      primary.textContent = content.howLabel;
      primary.onclick = showSteps;
    }

    actions.append(never, later, primary);
    card.append(head, title, body, steps, status, actions);

    host.append(card);
    live = card;

    // Forced reflow, not a frame callback: see `motion.ts`. Under the headless run in
    // `scripts/smoke.mjs` the frames never arrive, and the card would sit at opacity zero.
    reveal(card, "open");
    window.setTimeout(() => {
      card.style.willChange = "";
    }, ENTER_MS);

    // Asked, from this moment. Somebody who quits with the card up has still been asked.
    window.adcode.pinPrompt.shown();
  }

  return {
    offer(): void {
      if (asked || live !== null) return;
      asked = true;

      void window.adcode.pinPrompt.offer().then((offer) => {
        if (!offer.ask) return;

        /*
         * A release note owns this corner when it wants it. Standing down costs nothing -
         * `shown` is only recorded on display, so this launch is not counted as an ask and
         * the question comes back on the next eligible one.
         */
        if (document.querySelector(".release-card") !== null) {
          asked = false;
          return;
        }

        draw(offer.content);
      });
    },

    dismiss: close,
  };
}
