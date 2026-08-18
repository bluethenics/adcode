/**
 * The earnings report: what the ad side has actually paid, and what it would pay.
 *
 * A popover anchored to its activity-bar button rather than a sidebar view, because the
 * question it answers - "how much have I made?" - is asked in passing and answered in a
 * glance. A view would take the explorer's place to show four numbers, and the user would
 * have to navigate back to the thing they were doing.
 *
 * **The rule this panel is built around: never show a number the server did not send.**
 *
 * That is not a style preference here, it is the difference between a useful panel and a
 * harmful one. Brief §1 forbids the client computing money, and the README already records
 * what a panel of plausible-but-wrong statements costs: the Problems panel shipped showing
 * twenty-five true-but-irrelevant errors, and the lesson was that one false row teaches a
 * user to ignore the whole surface - after which the real row is invisible too. A fabricated
 * earnings figure is that failure with money attached.
 *
 * So there is no chart of daily income, no projected monthly total, and no impression
 * counter. None of those can be built from what this machine knows:
 *
 * - The balances are mirrored from `/v1/balance` and formatted by the ledger in integer
 *   arithmetic. Real, and the only two monetary figures here.
 * - The per-preset hourly projections come pre-computed from `/v1/config` (deviation D1,
 *   which exists precisely so §8.1 can be satisfied without the client doing the sum).
 * - The receipt queue is an **outbox**, not a history: entries are deleted once the server
 *   accepts them. So it can say how much is waiting to be sent, and it cannot say how many
 *   ads were ever shown. It is labelled as the former.
 * - Payout history, per-day reporting and anything resembling a statement need the backend
 *   that does not exist yet. The panel says so in those words instead of drawing an empty
 *   chart, which would read as "you have earned nothing" rather than "this is not built".
 */
import type { EarningsSnapshot } from "../../shared/api.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

export interface EarningsPopoverDeps {
  /** Where the card mounts. Positioned against `anchor`, so this is usually `document.body`. */
  readonly host: HTMLElement;
  /** The activity-bar button. Drives placement and its own `aria-expanded`. */
  readonly anchor: HTMLElement;
  /** Opens Settings at the ads group, for the one action this panel offers. */
  readonly openSettings: () => void;
}

export interface EarningsPopover {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** The main process broadcasts on every tick; the card redraws whether or not it is open. */
  update(snapshot: EarningsSnapshot): void;
}

/** Human wording for a preset id, since the ids are wire values. */
const PRESET_LABEL: Readonly<Record<string, string>> = {
  off: "Off",
  light: "Light",
  standard: "Standard",
  max: "Maximum",
};

function presetLabel(preset: string): string {
  return PRESET_LABEL[preset] ?? preset;
}

/**
 * "one every 4 min", from an interval in milliseconds.
 *
 * Rounded to whole minutes, and to whole seconds below a minute. This is a description of a
 * cadence, not a monetary value, so ordinary arithmetic is fine here - the bigint rule
 * governs money and nothing else.
 */
function cadence(minIntervalMs: number, dailyCap: number): string {
  if (dailyCap === 0) return "never";

  const minutes = Math.round(minIntervalMs / 60_000);
  const every = minutes >= 1 ? `${minutes} min` : `${Math.round(minIntervalMs / 1000)}s`;

  return `1 every ${every} · up to ${dailyCap}/day`;
}

function row(label: string, value: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "earnings-row";

  const name = document.createElement("span");
  name.className = "earnings-row-label";
  name.textContent = label;

  const amount = document.createElement("span");
  amount.className = "earnings-row-value";
  amount.textContent = value;

  line.append(name, amount);
  return line;
}

export function createEarningsPopover(deps: EarningsPopoverDeps): EarningsPopover {
  const card = document.createElement("section");
  card.className = "earnings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Earnings");
  card.hidden = true;

  /* ── Header ─────────────────────────────────────────────────────────────── */

  const header = document.createElement("header");
  header.className = "earnings-header";

  const title = document.createElement("h2");
  title.className = "earnings-title";
  title.textContent = "Earnings";

  /*
   * Refresh.
   *
   * The balance already arrives on its own every sixty seconds, so this is not how the number
   * gets updated - it is how somebody finds out *now*, after clicking an ad or reconnecting,
   * without watching the panel and wondering whether it is stuck. That distinction is why the
   * button reports what happened rather than silently returning: a refresh that changes nothing
   * looks identical to a refresh that never ran.
   */
  const refreshButton = iconButton("Refresh earnings", ICON.reload, "earnings-close");
  refreshButton.addEventListener("click", () => {
    void (async () => {
      if (refreshing) return;

      refreshing = true;
      refreshButton.disabled = true;
      refreshButton.dataset["busy"] = "true";

      try {
        const snapshot = await window.adcode.ads.refreshEarnings();
        api.update(snapshot);
        heroCaption.textContent = snapshot.hasServerBalance
          ? "Available to withdraw · just now"
          : "The server still has not reported a balance";
      } catch {
        // A failed refresh costs the refresh. §9: an ad failure is never allowed to be louder
        // than the thing it failed at.
        heroCaption.textContent = "Could not reach the server just now";
      } finally {
        refreshing = false;
        refreshButton.disabled = false;
        delete refreshButton.dataset["busy"];
      }
    })();
  });

  const closeButton = iconButton("Close earnings", ICON.close, "earnings-close");
  closeButton.addEventListener("click", () => api.close());

  header.append(title, refreshButton, closeButton);

  /* ── The hero figure ────────────────────────────────────────────────────── */

  const hero = document.createElement("div");
  hero.className = "earnings-hero";

  const heroValue = document.createElement("p");
  heroValue.className = "earnings-hero-value";
  heroValue.textContent = "—";

  const heroCaption = document.createElement("p");
  heroCaption.className = "earnings-hero-caption";
  heroCaption.textContent = "Available to withdraw";

  hero.append(heroValue, heroCaption);

  /* ── The facts ──────────────────────────────────────────────────────────── */

  const facts = document.createElement("div");
  facts.className = "earnings-facts";

  /* ── Presets ────────────────────────────────────────────────────────────── */

  const presetSection = document.createElement("div");
  presetSection.className = "earnings-section";

  const presetHeading = document.createElement("h3");
  presetHeading.className = "earnings-heading";
  presetHeading.textContent = "What each frequency pays";

  const presetList = document.createElement("ul");
  presetList.className = "earnings-presets";

  presetSection.append(presetHeading, presetList);

  /* ── The honest footer ──────────────────────────────────────────────────── */

  const footer = document.createElement("footer");
  footer.className = "earnings-footer";

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "ghost-button";
  settingsButton.textContent = "Ad settings";
  settingsButton.addEventListener("click", () => {
    api.close();
    deps.openSettings();
  });

  const note = document.createElement("p");
  note.className = "earnings-note";

  footer.append(settingsButton, note);

  card.append(header, hero, facts, presetSection, footer);
  deps.host.append(card);

  let open = false;
  let latest: EarningsSnapshot | null = null;
  /** Guards against a second request while one is in flight, which would race the render. */
  let refreshing = false;

  /**
   * Place the card beside its button.
   *
   * `position: fixed` against the anchor's own rectangle, then pulled back inside the
   * viewport - the activity bar runs the full height of the window, so a button near the
   * bottom would otherwise open a card that runs off the end of the screen.
   */
  function place(): void {
    const anchor = deps.anchor.getBoundingClientRect();
    const height = card.offsetHeight;
    const margin = 8;

    const top = Math.min(
      Math.max(margin, anchor.top - 4),
      Math.max(margin, window.innerHeight - height - margin),
    );

    card.style.left = `${anchor.right + margin}px`;
    card.style.top = `${top}px`;
  }

  function render(): void {
    const snapshot = latest;

    if (snapshot === null) {
      // Before the first broadcast. Not "$0.00": the difference between "nothing yet" and
      // "we have not heard" is the whole reason `hasServerBalance` exists.
      heroValue.textContent = "—";
      heroValue.dataset["known"] = "false";
      heroCaption.textContent = "Waiting for the server";
      facts.replaceChildren();
      presetList.replaceChildren();
      note.textContent = "";
      return;
    }

    heroValue.textContent = snapshot.hasServerBalance ? snapshot.availableLabel : "—";
    heroValue.dataset["known"] = String(snapshot.hasServerBalance);
    heroCaption.textContent = snapshot.hasServerBalance
      ? "Available to withdraw"
      : "The server has not reported a balance yet";

    facts.replaceChildren(
      row("Lifetime earned", snapshot.hasServerBalance ? snapshot.lifetimeLabel : "—"),
      row("Ads", snapshot.enabled ? "On" : "Off"),
      // Named for what it is. See the note at the top of this file on why this is not
      // presented as a count of ads seen.
      row(
        "Waiting to sync",
        snapshot.pendingReceipts === 0
          ? "Nothing pending"
          : `${snapshot.pendingReceipts} receipt${snapshot.pendingReceipts === 1 ? "" : "s"}`,
      ),
    );

    presetList.replaceChildren(
      ...snapshot.presets.map((option) => {
        const item = document.createElement("li");
        item.className = "earnings-preset";
        if (option.active) item.dataset["active"] = "true";

        const name = document.createElement("span");
        name.className = "earnings-preset-name";
        name.textContent = presetLabel(option.preset);
        if (option.active) name.textContent += " · current";

        const detail = document.createElement("span");
        detail.className = "earnings-preset-detail";
        detail.textContent = cadence(option.minIntervalMs, option.dailyCap);

        const rate = document.createElement("span");
        rate.className = "earnings-preset-rate";
        // `null` when `/v1/config` has not delivered a projections table. A dash, never a
        // guess: an hourly rate invented here would be the client computing money.
        rate.textContent = option.projectionLabel === null ? "—" : `${option.projectionLabel}/hr`;
        rate.dataset["known"] = String(option.projectionLabel !== null);

        item.append(name, detail, rate);
        return item;
      }),
    );

    note.textContent = snapshot.hasServerBalance
      ? "Payout history and statements need the advertiser backend, which is not built yet."
      : "Balances appear once the ad server answers. Nothing is estimated on this machine.";

    if (open) place();
  }

  /* ── Dismissal ──────────────────────────────────────────────────────────── */

  const onPointerDown = (event: PointerEvent): void => {
    if (!open) return;

    const target = event.target as Node;
    // The anchor is excluded so its own click can toggle rather than close-then-reopen.
    if (card.contains(target) || deps.anchor.contains(target)) return;

    api.close();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
      // Focus goes back to the button that opened it, or it lands on the body and the next
      // Tab starts from the top of the window.
      deps.anchor.focus();
    }
  };

  const onResize = (): void => {
    if (open) place();
  };

  const api: EarningsPopover = {
    open(): void {
      if (open) return;

      open = true;
      card.hidden = false;
      deps.anchor.setAttribute("aria-expanded", "true");

      // Measured after unhiding: `offsetHeight` on a hidden element is zero, so placing
      // before this point pins the card to the top of the window every time.
      place();

      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeydown);
      window.addEventListener("resize", onResize);
    },

    close(): void {
      if (!open) return;

      open = false;
      card.hidden = true;
      deps.anchor.setAttribute("aria-expanded", "false");

      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open,

    update(snapshot: EarningsSnapshot): void {
      latest = snapshot;
      render();
    },
  };

  render();

  return api;
}
