/**
 * The earnings report: what the ad side has actually paid, and what it would pay.
 *
 * A glanceable summary inside the shared sidebar. It uses the same navigation model as the
 * other activity icons, so it is easy to find, close, and revisit without managing a floating
 * card over the editor.
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
import type { AccountState, EarningsSnapshot } from "../../shared/api.ts";
import { ICON, iconButton } from "../workbench/icons.ts";

export interface EarningsPopoverDeps {
  /** The shared sidebar view that owns the card. */
  readonly host: HTMLElement;
  /** Ask the workbench shell to close the shared sidebar. */
  readonly requestClose: () => void;
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

/**
 * The account id, with a button that copies it.
 *
 * Copyable rather than merely shown, because the only thing anyone does with a 28-character
 * Firebase uid is paste it somewhere - into the admin panel's user picker, which searches by
 * name and address and so cannot find an anonymous account any other way. Reading it off the
 * screen by hand is how you queue a test card to the wrong account.
 */
function accountIdRow(uid: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "earnings-row";

  const name = document.createElement("span");
  name.className = "earnings-row-label";
  name.textContent = "This editor's account";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "earnings-row-value earnings-uid";
  // The full id is the thing being copied, so it is the thing announced and the thing on
  // hover - the middle is elided only because the popover is narrow.
  button.textContent = `${uid.slice(0, 6)}…${uid.slice(-4)}`;
  button.title = uid;
  button.setAttribute("aria-label", `Copy account id ${uid}`);

  button.addEventListener("click", () => {
    void window.adcode.clipboard.writeText(uid).then(() => {
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = `${uid.slice(0, 6)}…${uid.slice(-4)}`;
      }, 1200);
    });
  });

  line.append(name, button);
  return line;
}

export function createEarningsPopover(deps: EarningsPopoverDeps): EarningsPopover {
  const card = document.createElement("section");
  card.className = "earnings-card";
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Earnings");

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
  closeButton.addEventListener("click", () => deps.requestClose());

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

  /* ── Account ────────────────────────────────────────────────────────────── */

  /*
   * The sign-in prompt.
   *
   * It does NOT say "sign in to earn", because that would be false: earnings accrue from
   * first launch with no account at all, which is the whole point of the no-wall design.
   * What an account buys is keeping the money - reaching it from the dashboard, and
   * withdrawing it from there. Saying the true thing is also the more
   * persuasive thing, because the false version collapses the moment someone notices
   * their balance rising while signed out.
   */
  const accountRow = document.createElement("div");
  accountRow.className = "earnings-account";
  accountRow.hidden = true;

  const avatar = document.createElement("img");
  avatar.className = "earnings-avatar";
  avatar.alt = "";
  avatar.hidden = true;
  // A provider's CDN can 404 or be blocked; falling back to nothing beats a broken image.
  avatar.addEventListener("error", () => {
    avatar.hidden = true;
  });

  const accountText = document.createElement("div");
  accountText.className = "earnings-account-text";

  const accountTitle = document.createElement("span");
  accountTitle.className = "earnings-account-title";

  const accountBody = document.createElement("span");
  accountBody.className = "earnings-account-body";

  accountText.append(accountTitle, accountBody);

  const accountActions = document.createElement("div");
  accountActions.className = "earnings-account-actions";

  const googleButton = document.createElement("button");
  googleButton.type = "button";
  googleButton.className = "ghost-button";
  googleButton.textContent = "Google";

  const githubButton = document.createElement("button");
  githubButton.type = "button";
  githubButton.className = "ghost-button";
  githubButton.textContent = "GitHub";

  accountActions.append(googleButton, githubButton);
  accountRow.append(avatar, accountText, accountActions);

  const linking = (busy: boolean): void => {
    googleButton.disabled = busy;
    githubButton.disabled = busy;
  };

  /** Paints whichever of the three states the account is in. */
  function renderAccount(state: AccountState): void {
    accountUid = state.state === "unavailable" ? null : (state.uid ?? null);
    // The id lives in the facts list, which `render` owns, so a state that arrives after
    // the first paint has to ask for a redraw rather than only updating the card below.
    if (latest !== null) render();

    if (state.state === "unavailable") {
      accountRow.hidden = true;
      return;
    }

    accountRow.hidden = false;
    accountRow.dataset["linked"] = state.state === "linked" ? "true" : "false";

    if (state.state === "linked") {
      accountActions.hidden = true;
      accountTitle.textContent = state.displayName ?? state.email ?? "Signed in";
      accountBody.textContent = "Your earnings follow this account.";

      if (state.photoUrl !== null) {
        avatar.src = state.photoUrl;
        avatar.hidden = false;
      } else {
        avatar.hidden = true;
      }
      return;
    }

    avatar.hidden = true;
    accountActions.hidden = false;
    accountTitle.textContent = "Keep these earnings";
    accountBody.textContent =
      "You're earning already. Sign in to see this balance on the web and to withdraw it later.";
  }

  const attemptLink = (provider: "google" | "github") => {
    linking(true);
    accountBody.textContent = "Finishing in your browser…";

    void window.adcode.account
      .link(provider)
      .then((outcome) => {
        linking(false);
        if (outcome.ok) renderAccount(outcome.state);
        else accountBody.textContent = outcome.message;
      })
      .catch(() => {
        linking(false);
        accountBody.textContent = "Sign-in didn't complete. Try again.";
      });
  };

  googleButton.addEventListener("click", () => attemptLink("google"));
  githubButton.addEventListener("click", () => attemptLink("github"));

  // GitHub's device flow needs the user to type a code, so it is shown as it arrives.
  window.adcode.account.onDeviceCode((code) => {
    accountBody.textContent = `Enter code ${code.userCode} at ${code.verificationUri}`;
  });

  window.adcode.account.onChanged((state) => renderAccount(state));
  void window.adcode.account.status().then(renderAccount);

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

  card.append(header, hero, facts, accountRow, presetSection, footer);
  deps.host.append(card);

  let open = false;
  let latest: EarningsSnapshot | null = null;
  /** Null until the account state has been read, and on builds with no Firebase project. */
  let accountUid: string | null = null;
  /** Guards against a second request while one is in flight, which would race the render. */
  let refreshing = false;

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
      row("Next card", nextCardLabel(snapshot.suppressedReason, snapshot.enabled)),
      // Last, because it is a diagnostic rather than something to read every day - but
      // here rather than buried in settings, because this popover is where somebody
      // already is when they are wondering why no card has arrived.
      ...(accountUid === null ? [] : [accountIdRow(accountUid)]),
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

  }

  /* ── Dismissal ──────────────────────────────────────────────────────────── */


  const api: EarningsPopover = {
    open(): void {
      if (open) return;

      open = true;
    },

    close(): void {
      if (!open) return;

      open = false;
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open && !deps.host.hidden,

    update(snapshot: EarningsSnapshot): void {
      latest = snapshot;
      render();
    },
  };

  render();

  return api;
}

/**
 * Why a card is not appearing, in words.
 *
 * The scheduler has always known this and it only ever reached a debug log, so "I set up
 * an ad and it never showed" had no answer short of reading the source. Usually the
 * honest answer is "you are partway through a gap", which is not a fault and should not
 * have to be guessed at.
 *
 * Each of these names a condition the person can act on, or tells them to wait. None of
 * them says "error", because none of them is one.
 */
function nextCardLabel(reason: string | null, enabled: boolean): string {
  if (!enabled) return "Ads are switched off";
  if (reason === null) return "Ready — at the next pause";

  switch (reason) {
    case "ads-disabled":
      return "Ads are switched off";
    case "frequency-off":
      return "Frequency is set to Off";
    case "kill-switch":
      return "Paused by the server";
    case "settling":
      return "Just after launch — a moment";
    case "window-unfocused":
      return "When this window is in front";
    case "debug-active":
      return "Not while you are debugging";
    case "do-not-disturb":
      return "Do not disturb is on";
    case "daily-cap":
      return "You have reached today's limit";
    case "min-interval":
      return "Waiting out the gap since the last one";
    case "no-creative":
      return "No card available for you right now";
    default:
      // A reason from a newer build than this one. Saying nothing is better than
      // printing an identifier at somebody.
      return "Waiting for the right moment";
  }
}
