/**
 * The web version's front door: sign in, then wait while the workspace wakes.
 *
 * Shown before the renderer loads, in `#web-gate`. Signing in is required, because each person
 * gets a private cloud sandbox and anonymous accounts are free to mint. Google, GitHub and email
 * all use the Firebase project the desktop and the site use, so the same person lands on the
 * same account - and the same earnings - everywhere.
 *
 * In development (`npm run web:vibe`) a dev-mode button skips sign-in; the production build
 * cannot show it (`__ADCODE_WEB_DEV__` is compiled to `false`, pinned by a test).
 */
import { brandMark } from "../renderer/workbench/brandMark.ts";
import { mountMark } from "./asciiMark.ts";
import { currentUser, firebaseConfigured, idToken, resetPassword, signInWith, signInWithEmail, signOutHere } from "./firebaseAuth.ts";
import { firebaseErrorText } from "./gateText.ts";
import { WEB_APP_GUIDE_URL, WEB_APP_HEADING, WEB_APP_INTRO } from "./seo.ts";
import { createIcon } from "../renderer/workbench/icons.ts";
import { GATE_IDEA_MAX, peekGateIdea, saveGateIdea, STARTER_IDEAS } from "../renderer/onboarding/starterIdeas.ts";
import { Check, CircleCheck } from "lucide";

declare const __ADCODE_WEB_DEV__: boolean;

export interface WebSession {
  /** A Firebase ID token; "dev" in development mode. */
  readonly token: string | null;
  readonly email: string | null;
  /** Stable namespace for local drafts and queued receipts; never used for authorization. */
  readonly uid?: string;
  /** A current token, forcing a refresh when asked. */
  refresh(force?: boolean): Promise<string | null>;
  signOut(): Promise<void>;
}

const SITE = "https://adcode.bluethenics.com";

function host(): HTMLElement {
  let element = document.getElementById("web-gate");
  if (element === null) {
    element = document.createElement("div");
    element.id = "web-gate";
    document.body.prepend(element);
  }
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const GOOGLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-2 3.2-4.9 3.2-8.2z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"/></svg>';
const MAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>';
const GITHUB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7 0-.6 0-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a9.9 9.9 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z"/></svg>';

/*
 * The stage beside the card: what ADCode does, shown rather than said. An agent's run types
 * itself out on a slow loop over a live grid - the request, the tools it calls, the check that
 * passes, the preview that opens. Decoration only (aria-hidden); with reduced motion it is the
 * finished run, still.
 */
type RunStep = { readonly kind: "ask" | "step" | "done"; readonly text: string; readonly detail?: string };
const RUN: readonly RunStep[] = [
  { kind: "ask", text: "build a booking page for my barber shop" },
  { kind: "step", text: "Read", detail: "package.json · src/App.tsx" },
  { kind: "step", text: "Helpers", detail: "3 working at once" },
  { kind: "step", text: "Wrote", detail: "src/Booking.tsx +184" },
  { kind: "step", text: "Changes", detail: "2 files · ready to review" },
  { kind: "done", text: "Pull request opened", detail: "barber-shop #12" },
];
/**
 * The same run for whatever the visitor has typed into the card: their idea is what the stage
 * types out, so the picture beside the sign-in buttons is of the thing they asked for.
 */
function runFor(idea: string): readonly RunStep[] {
  const ask = idea.replace(/\s+/g, " ").trim();
  if (ask.length === 0) return RUN;
  return [
    { kind: "ask", text: ask.length > 64 ? `${ask.slice(0, 63).trimEnd()}…` : ask },
    { kind: "step", text: "Planned", detail: "a new project · 4 files" },
    { kind: "step", text: "Wrote", detail: "index.html · app.js · style.css" },
    { kind: "step", text: "Preview", detail: "running in this tab" },
    { kind: "done", text: "Ready to try", detail: "change anything by asking" },
  ];
}
/** What the stage is playing now; the card swaps it as the visitor types. */
let currentRun: readonly RunStep[] = RUN;
let stageLines: HTMLElement | null = null;
let stageTimer: number | undefined;
/** The current card's mark animation; a screen change takes the old one down with its card. */
let stopMark: (() => void) | null = null;
/** Bumped by every screen change, so a gate fading out never hides the screen that replaced it. */
let generation = 0;

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function stage(): HTMLElement {
  const root = element("aside", "web-gate-stage");
  root.setAttribute("aria-hidden", "true");
  const grid = element("div", "web-gate-grid");
  const glow = element("div", "web-gate-glow");
  const brand = element("div", "web-gate-brand");
  brand.append(brandMark({ size: 34, plate: true, accent: true }), element("span", "web-gate-wordmark", "ADCode"));
  const pitch = element("div", "web-gate-pitch");
  pitch.append(element("h2", undefined, "Describe it. Watch it get built."), element("p", undefined, "Agents read your GitHub project, write the code and show you every change - in a workspace that lives in your browser."));
  const terminal = element("div", "web-gate-terminal");
  const bar = element("div", "web-gate-terminal-bar");
  bar.append(element("i"), element("i"), element("i"), element("span", undefined, "agent · live"));
  const lines = element("ol", "web-gate-lines");
  terminal.append(bar, lines);
  const proof = element("ul", "web-gate-proof");
  for (const fact of ["Included AI, no subscription needed", "GitHub projects, with changes you review", "Half of the ad revenue is yours"]) proof.append(element("li", undefined, fact));
  root.append(grid, glow, brand, pitch, terminal, proof);
  stageLines = lines;
  currentRun = RUN;
  play(lines);
  return root;
}

function line(step: RunStep): HTMLLIElement {
  const item = element("li", `web-gate-line is-${step.kind}`);
  if (step.kind === "ask") {
    item.append(element("span", "web-gate-prompt", "›"), element("span", "web-gate-typed", ""));
  } else {
    const tick = element("span", "web-gate-tick", ""); tick.append(createIcon(step.kind === "done" ? CircleCheck : Check));
    item.append(tick, element("strong", undefined, step.text), element("span", "web-gate-detail", step.detail ?? ""));
  }
  return item;
}

/** Type the request, then let each step land after the one before, and start again. */
function play(lines: HTMLElement): void {
  window.clearTimeout(stageTimer);
  const run = currentRun;
  if (reducedMotion()) {
    lines.replaceChildren(...run.map(line));
    const typed = lines.querySelector(".web-gate-typed");
    if (typed !== null) typed.textContent = run[0]!.text;
    return;
  }
  lines.replaceChildren();
  const ask = line(run[0]!);
  lines.append(ask);
  const typed = ask.querySelector(".web-gate-typed")!;
  typed.classList.add("is-typing");
  let at = 0;
  const type = (): void => {
    if (!lines.isConnected) return;
    typed.textContent = run[0]!.text.slice(0, ++at);
    if (at < run[0]!.text.length) { stageTimer = window.setTimeout(type, 28 + Math.random() * 34); return; }
    typed.classList.remove("is-typing");
    let step = 1;
    const next = (): void => {
      if (!lines.isConnected) return;
      if (step < run.length) { lines.append(line(run[step++]!)); stageTimer = window.setTimeout(next, 620); return; }
      stageTimer = window.setTimeout(() => play(lines), 4200);
    };
    stageTimer = window.setTimeout(next, 480);
  };
  stageTimer = window.setTimeout(type, 500);
}

/** Replays the stage with the visitor's idea, once they pause typing. */
let restageTimer: number | undefined;
function restage(idea: string): void {
  window.clearTimeout(restageTimer);
  restageTimer = window.setTimeout(() => {
    const next = runFor(idea);
    if (stageLines === null || !stageLines.isConnected || next[0]!.text === currentRun[0]!.text) return;
    currentRun = next;
    play(stageLines);
  }, 650);
}

function shell(): { card: HTMLElement; body: HTMLElement } {
  const root = host();
  generation += 1;
  root.replaceChildren();
  stopMark?.();
  stopMark = null;
  root.hidden = false;
  root.className = "web-gate";
  const card = element("main", "web-gate-card");
  // The login page's ribbon mark, in ASCII. The splash ships the same rows, so the sweep that
  // started before any script keeps running - now from the canvas, and it can be stirred.
  const mark = element("canvas", "web-gate-mark");
  mark.setAttribute("aria-hidden", "true");
  stopMark = mountMark(mark);
  const body = element("div", "web-gate-body");
  card.append(mark, body);
  const panel = element("div", "web-gate-panel");
  panel.append(card);
  root.append(stage(), panel);
  return { card, body };
}

/** The sign-in card. Resolves once someone is signed in (or chose dev mode). */
function signInCard(): Promise<"signed-in" | "dev"> {
  return new Promise((resolve) => {
    const { body } = shell();
    const title = element("h1", "web-gate-title", WEB_APP_HEADING);
    const lead = element("p", "web-gate-lead", `${WEB_APP_INTRO} Free - no card, no API key.`);
    const error = element("p", "web-gate-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const showError = (code: unknown): void => {
      const message = firebaseErrorText(typeof code === "string" ? code : null);
      error.textContent = message ?? "";
      error.hidden = message === null;
    };

    const actions = element("div", "web-gate-actions");
    const provider = (label: string, icon: string, which: "google" | "github"): HTMLButtonElement => {
      const button = element("button", "web-gate-button web-gate-provider");
      button.type = "button";
      button.innerHTML = icon;
      button.append(element("span", undefined, label));
      button.addEventListener("click", () => {
        error.hidden = true;
        for (const control of actions.querySelectorAll("button")) control.disabled = true;
        signInWith(which)
          .then(() => resolve("signed-in"))
          .catch((failure: unknown) => {
            showError((failure as { code?: unknown }).code);
            for (const control of actions.querySelectorAll("button")) control.disabled = false;
          });
      });
      return button;
    };

    /*
     * "What do you want to build?", before signing in. The web version is where people try
     * ADCode, and an idea typed here is the reason to finish signing in: it is kept across the
     * sign-in (starterIdeas.ts) and the app starts building it the moment it opens, instead of
     * asking the same question again behind a welcome sheet.
     */
    const idea = ideaBox(() => {
      const first = actions.querySelector<HTMLButtonElement>(".web-gate-provider, .web-gate-dev");
      first?.focus({ preventScroll: true });
      first?.classList.remove("is-nudged");
      void first?.offsetWidth;
      first?.classList.add("is-nudged");
    });
    const next = element("p", "web-gate-next", "Sign in free to start. Nothing to install.");
    next.setAttribute("aria-live", "polite");
    idea.onChange((text) => {
      next.textContent = text.length > 0
        ? "Sign in and ADCode starts building it right away."
        : "Sign in free to start. Nothing to install.";
      next.dataset["ready"] = String(text.length > 0);
    });

    const available = firebaseConfigured();
    if (available) {
      actions.append(provider("Continue with Google", GOOGLE_ICON, "google"), provider("Continue with GitHub", GITHUB_ICON, "github"));

      // Email is the third way in, folded until chosen: three equal buttons read faster than a form.
      const reveal = element("button", "web-gate-button web-gate-email-toggle");
      reveal.type = "button";
      reveal.innerHTML = MAIL_ICON;
      reveal.append(element("span", undefined, "Continue with email"));
      reveal.setAttribute("aria-expanded", "false");

      const form = element("form", "web-gate-email");
      form.noValidate = true;
      form.hidden = true;
      reveal.addEventListener("click", () => {
        reveal.hidden = true;
        reveal.setAttribute("aria-expanded", "true");
        form.hidden = false;
        email.focus();
      });
      const email = element("input", "web-gate-input");
      email.type = "email";
      email.autocomplete = "email";
      email.placeholder = "Email";
      email.setAttribute("aria-label", "Email");
      const password = element("input", "web-gate-input");
      password.type = "password";
      password.autocomplete = "current-password";
      password.placeholder = "Password";
      password.setAttribute("aria-label", "Password");
      let creating = false;
      const submit = element("button", "web-gate-button web-gate-primary", "Sign in with email");
      submit.type = "submit";
      const switcher = element("div", "web-gate-links");
      const toggle = element("button", "web-gate-link", "New here? Create an account");
      toggle.type = "button";
      const forgot = element("button", "web-gate-link", "Forgot password?");
      forgot.type = "button";
      toggle.addEventListener("click", () => {
        creating = !creating;
        submit.textContent = creating ? "Create account" : "Sign in with email";
        toggle.textContent = creating ? "Have an account? Sign in" : "New here? Create an account";
        password.autocomplete = creating ? "new-password" : "current-password";
        forgot.hidden = creating;
      });
      forgot.addEventListener("click", () => {
        const address = email.value.trim();
        if (address.length === 0) {
          error.textContent = "Type your email first, then choose Forgot password.";
          error.hidden = false;
          email.focus();
          return;
        }
        resetPassword(address)
          .then(() => {
            error.textContent = `If ${address} has an account, a reset link is on its way.`;
            error.hidden = false;
          })
          .catch((failure: unknown) => showError((failure as { code?: unknown }).code));
      });
      switcher.append(toggle, forgot);
      form.append(email, password, submit, switcher);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        error.hidden = true;
        submit.disabled = true;
        signInWithEmail(email.value.trim(), password.value, creating)
          .then(() => resolve("signed-in"))
          .catch((failure: unknown) => {
            showError((failure as { code?: unknown }).code);
            submit.disabled = false;
          });
      });
      actions.append(reveal, form);
    } else {
      const unavailable = element("p", "web-gate-lead", "Sign-in isn't configured for this build.");
      actions.append(unavailable);
    }

    if (__ADCODE_WEB_DEV__) {
      const dev = element("button", "web-gate-button web-gate-dev", "Continue in dev mode");
      dev.type = "button";
      dev.addEventListener("click", () => resolve("dev"));
      actions.append(dev);
    }

    const fine = element("p", "web-gate-fine");
    fine.append(
      Object.assign(element("a", undefined, "How ADCode Web works"), { href: WEB_APP_GUIDE_URL }),
      document.createTextNode(". "),
      document.createTextNode("It runs in this tab: nothing to install and no computer to wait for. Ads keep it free, and you earn a share of them. "),
      Object.assign(element("a", undefined, "Terms"), { href: `${SITE}/terms`, target: "_blank", rel: "noopener" }),
      document.createTextNode(" · "),
      Object.assign(element("a", undefined, "Privacy"), { href: `${SITE}/privacy`, target: "_blank", rel: "noopener" }),
    );

    body.append(title, lead, idea.element, next, actions, error, fine);
    // The idea box on a laptop; never on a phone, where focus would throw up the keyboard over
    // the page before anyone has read it. Without scrolling, so the card opens at its top.
    if (window.matchMedia("(pointer: fine)").matches) idea.input.focus({ preventScroll: true });
  });
}

/** The idea box: a two-line prompt and a few ideas to start from. */
function ideaBox(submit: () => void): { element: HTMLElement; input: HTMLTextAreaElement; onChange(listener: (text: string) => void): void } {
  const box = element("div", "web-gate-idea");
  const label = element("label", "web-gate-idea-label", "What do you want to build?");
  const input = element("textarea", "web-gate-idea-input");
  input.id = "web-gate-idea";
  label.htmlFor = input.id;
  input.rows = 2;
  input.maxLength = GATE_IDEA_MAX;
  input.placeholder = "A booking page for my barber shop, with prices and opening hours";
  input.autocomplete = "off";
  const listeners: ((text: string) => void)[] = [];
  const changed = (): void => {
    const text = input.value.trim();
    saveGateIdea(text);
    restage(text);
    box.dataset["filled"] = String(text.length > 0);
    for (const listener of listeners) listener(text);
  };
  input.addEventListener("input", changed);
  // Enter is "done describing it": on to signing in. Shift+Enter is a new line, as in the chat.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (input.value.trim().length > 0) submit();
  });

  const chips = element("div", "web-gate-ideas");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Ideas to start from");
  for (const starter of STARTER_IDEAS.slice(0, 5)) {
    const chip = element("button", "web-gate-chip", starter.label);
    chip.type = "button";
    chip.addEventListener("click", () => {
      input.value = starter.prompt;
      changed();
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    chips.append(chip);
  }
  box.append(label, input, chips);

  // An idea already typed in this tab - a failed sign-in, a reload - is still there.
  const kept = peekGateIdea();
  if (kept !== null) { input.value = kept; queueMicrotask(changed); }

  return { element: box, input, onChange: (listener) => { listeners.push(listener); } };
}

/** Signs the person in (or reuses a saved session) and returns what the socket needs. */
export async function gate(): Promise<WebSession> {
  const restored = firebaseConfigured() ? await currentUser() : null;
  if (restored === null) {
    const outcome = await signInCard();
    if (outcome === "dev") {
      // "dev" is accepted only by a local Worker started with ALLOW_DEV_TOKEN=1; adcode-host ignores it.
      return { token: "dev", email: null, uid: "web-dev-user", refresh: async () => "dev", signOut: async () => location.reload() };
    }
  }
  const token = await idToken();
  const user = firebaseConfigured() ? await currentUser() : null;
  return {
    token,
    email: user?.email ?? null,
    ...(user === null ? {} : { uid: user.uid }),
    refresh: async (force = false) => {
      const fresh = await idToken(force);
      const active = await currentUser();
      if (active?.uid !== user?.uid) throw new Error("Your signed-in account changed. Reload ADCode before continuing.");
      return fresh;
    },
    signOut: async () => {
      await signOutHere();
      location.reload();
    },
  };
}

/**
 * The waking screen, shown until the sandbox's first greeting - the mark keeps sweeping while
 * the status line and the bar say what is happening, the same rhythm as the splash it replaced.
 */
export function showWaking(message = "Starting ADCode…", detail = "It runs in this tab, so it opens in a few seconds."): void {
  const { body } = shell();
  const status = element("p", "web-gate-title web-gate-title-small", message);
  status.setAttribute("role", "status");
  const progress = element("div", "web-gate-progress");
  progress.setAttribute("aria-hidden", "true");
  body.append(status, element("p", "web-gate-lead", detail), progress);
}

/** A full-screen message with actions: no time left in this session, the web version is full, and so on. */
export function showBlocked(title: string, detail: string, actions: readonly { label: string; primary?: boolean; run: () => void }[]): void {
  const { body } = shell();
  const heading = element("h1", "web-gate-title", title);
  const lead = element("p", "web-gate-lead", detail);
  const row = element("div", "web-gate-actions");
  for (const action of actions) {
    const button = element("button", `web-gate-button${action.primary === true ? " web-gate-primary" : ""}`, action.label);
    button.type = "button";
    button.addEventListener("click", action.run);
    row.append(button);
  }
  body.append(heading, lead, row);
}

/** Fades the gate out over the app, then removes it; a screen shown meanwhile cancels the fade. */
export function hideGate(): void {
  const root = host();
  if (root.hidden) return;
  const mine = generation;
  const finish = (): void => {
    if (mine !== generation) return;
    window.clearTimeout(stageTimer);
    stopMark?.();
    stopMark = null;
    root.hidden = true;
    root.classList.remove("is-leaving");
    root.replaceChildren();
  };
  if (reducedMotion()) { finish(); return; }
  root.classList.add("is-leaving");
  window.setTimeout(finish, 260);
}
