/**
 * The first thing a new install shows: "What do you want to build?"
 *
 * Production on 2026-10-03: of 419 real installs, 394 were gone within five minutes and
 * five ever came back. The old welcome was five steps - Vibe or Code, a theme, how often
 * ads appear, an account, three tips - and none of them got anything built. After it, the
 * checklist said "Open a project folder" to people who had an idea rather than a folder,
 * then "Connect a model" to a screen of fourteen paid providers. The first prompt anybody
 * sent was answered with "No model connected".
 *
 * Now the welcome is the first prompt:
 *
 * 1. **The idea.** One box, a few ideas to start from, and "open a folder" for people who
 *    already have a project.
 * 2. **The AI**, only when nothing is connected yet: `quickConnect`, led by a free Gemini
 *    key that needs no card.
 * 3. **The build.** ADCode makes a project folder named after the idea, opens it, and sends
 *    the idea as the first prompt - so the first thing the person sees ADCode do is build
 *    what they asked for.
 *
 * Everything is skippable and Escape closes it, because ADCode's promise is that there is
 * no wall on first launch. The theme, ad frequency and account are still one click away in
 * Settings - nobody downloads an editor to choose a theme - and the one line about ads
 * stays on the first screen, because how ADCode is paid for is worth knowing on day one.
 */
import { createQuickConnect, type QuickConnect } from "../ai/quickConnect.ts";
import { fillPartnerNote } from "../ai/partnerNote.ts";
import type { PartnerView } from "../../shared/tagflow.ts";

export interface OnboardingSheet {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface OnboardingDeps {
  /** Records that this machine has been welcomed, so it happens once. */
  complete: () => void;
  /** Whether a model is connected and ready right now. */
  aiReady: () => Promise<boolean>;
  /**
   * The partner running the model in use (Tag Flow AI), or null. Their privacy policy and
   * terms apply to what Build it sends, so the welcome says so before anything is sent.
   */
  partner?: () => Promise<PartnerView | null>;
  /**
   * Make a project for the idea (unless a folder is already open), open it, and put the
   * idea to the assistant - sent when `send` is true, left in the composer otherwise.
   */
  build: (idea: string, send: boolean) => Promise<void>;
  /** Open a folder the person already has. */
  openFolder: () => void;
  /** The full Connect screen, for every provider the quick routes do not cover. */
  openAllProviders: () => void;
  /** Settings, at the ads section. */
  openAdSettings: () => void;
  /**
   * Look once for an invite the invite page put on the clipboard, and claim it. Who invited
   * them, if one was claimed now; null otherwise. The clipboard itself is read in main.
   */
  invite?: () => Promise<{ inviterName: string | null } | null>;
}

/** Ideas that build into something the preview shows straight away. */
const IDEAS: readonly { readonly label: string; readonly prompt: string }[] = [
  { label: "Landing page", prompt: "A landing page for my small business, with a hero section, services, testimonials and a contact form." },
  { label: "Portfolio", prompt: "A personal portfolio site with an about section, my projects and a way to contact me." },
  { label: "To-do app", prompt: "A to-do app where I can add, tick off and delete tasks, saved in the browser." },
  { label: "Snake game", prompt: "A snake game in the browser with a score, a high score and a restart button." },
  { label: "Budget tracker", prompt: "A budget tracker where I add income and expenses and see my balance and a chart by category." },
  { label: "Quiz", prompt: "A quiz app with ten multiple-choice questions, a progress bar and a score at the end." },
];

export function createOnboardingSheet(deps: OnboardingDeps): OnboardingSheet {
  const dialog = document.createElement("dialog");
  dialog.className = "onboarding onboarding-build";

  let step: "idea" | "connect" = "idea";
  let idea = "";
  let finished = false;
  let quick: QuickConnect | null = null;

  const body = document.createElement("div");
  body.className = "onboarding-body";

  const dots = document.createElement("div");
  dots.className = "onboarding-dots";

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "onboarding-skip";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "chat-send onboarding-next";

  const footer = document.createElement("div");
  footer.className = "onboarding-footer";
  footer.append(skip, dots, next);

  /*
   * "Sam invited you." A familiar name in the first minute is a reason to stay past it,
   * and the first five minutes are where most installs were lost.
   */
  const invited = document.createElement("p");
  invited.className = "onboarding-invited";
  invited.setAttribute("role", "status");
  invited.hidden = true;

  dialog.append(invited, body, footer);
  document.body.append(dialog);

  /**
   * The invite page copies `ADCode invite: <code>` as the download starts, so it is usually
   * still on the clipboard the first time ADCode opens - and if someone copies it from the
   * page afterwards, they come back to this window, which is the focus check.
   */
  const lookForInvite = (): void => {
    if (deps.invite === undefined || !invited.hidden) return;
    void deps.invite().then((found) => {
      if (found === null || !dialog.open) return;
      invited.textContent = found.inviterName === null
        ? "You came with an invite - welcome to ADCode."
        : `${found.inviterName} invited you - welcome to ADCode.`;
      invited.hidden = false;
    });
  };
  const onFocus = (): void => {
    if (dialog.open) lookForInvite();
  };

  /** Close the sheet; `outcome` says which milestone the person reached. */
  const finish = (outcome: "welcome_done" | "welcome_skipped"): void => {
    if (!finished) window.adcode.milestones.record(outcome);
    finished = true;
    quick?.dispose();
    quick = null;
    deps.complete();
    if (dialog.open) dialog.close();
  };

  const go = (send: boolean): void => {
    const text = idea.trim();
    finish("welcome_done");
    if (text.length > 0) void deps.build(text, send);
  };

  skip.addEventListener("click", () => {
    if (step === "connect") go(false);
    else finish("welcome_skipped");
  });

  next.addEventListener("click", () => {
    if (step !== "idea" || idea.trim().length === 0) return;
    next.disabled = true;
    void deps.aiReady().then((ready) => {
      next.disabled = false;
      if (ready) go(true);
      else {
        step = "connect";
        render();
      }
    }, () => {
      next.disabled = false;
      go(false);
    });
  });

  // Escape closes a `<dialog>` for free, and closing it any way at all counts as done:
  // being asked the same question on every launch is worse than missing it once.
  dialog.addEventListener("close", () => {
    if (!finished) finish("welcome_skipped");
  });

  function heading(title: string, lede: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "onboarding-head";
    const h = document.createElement("h2");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = lede;
    wrap.append(h, p);
    return wrap;
  }

  function renderIdea(): void {
    const box = document.createElement("textarea");
    box.className = "onboarding-idea";
    box.rows = 3;
    box.placeholder = "A landing page for my bakery, with the menu and opening hours";
    box.value = idea;
    box.setAttribute("aria-label", "What do you want to build?");
    box.addEventListener("input", () => {
      idea = box.value;
      next.disabled = idea.trim().length === 0;
    });
    box.addEventListener("keydown", (event) => {
      // Enter builds, as in the chat composer; Shift+Enter is a new line.
      if (event.key === "Enter" && !event.shiftKey && idea.trim().length > 0) {
        event.preventDefault();
        next.click();
      }
    });

    const chips = document.createElement("div");
    chips.className = "onboarding-ideas";
    chips.setAttribute("aria-label", "Ideas to start from");
    for (const option of IDEAS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "onboarding-idea-chip";
      chip.textContent = option.label;
      chip.addEventListener("click", () => {
        idea = option.prompt;
        box.value = idea;
        next.disabled = false;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
      chips.append(chip);
    }

    const existing = document.createElement("p");
    existing.className = "onboarding-existing";
    const openFolder = document.createElement("button");
    openFolder.type = "button";
    openFolder.className = "onboarding-link";
    openFolder.textContent = "Open a folder";
    openFolder.addEventListener("click", () => {
      finish("welcome_done");
      deps.openFolder();
    });
    existing.append("Already have a project? ", openFolder, ".");

    const ads = document.createElement("p");
    ads.className = "onboarding-ads-note";
    const adsLink = document.createElement("button");
    adsLink.type = "button";
    adsLink.className = "onboarding-link";
    adsLink.textContent = "Ad settings";
    adsLink.addEventListener("click", () => {
      finish("welcome_skipped");
      deps.openAdSettings();
    });
    ads.append(
      "ADCode is free. Once you have built something, a small sponsored card appears now and then - half of what it earns is yours. ",
      adsLink,
    );
    // Filled once the model in use is known; empty (and hidden) unless a partner runs it.
    const partnerNote = document.createElement("p");
    partnerNote.className = "onboarding-partner-note";
    partnerNote.hidden = true;
    void deps.partner?.().then((partner) => {
      if (partner === null) return;
      fillPartnerNote(partnerNote, partner);
      partnerNote.hidden = false;
    }, () => undefined);

    body.append(
      heading("What do you want to build?", "Describe it in a sentence. ADCode makes the project, writes the code and shows it running."),
      box,
      chips,
      existing,
      ads,
      partnerNote,
    );
    next.disabled = idea.trim().length === 0;
    requestAnimationFrame(() => box.focus());
  }

  function renderConnect(): void {
    quick?.dispose();
    quick = createQuickConnect({
      onConnected: () => window.setTimeout(() => go(true), 600),
      openAllProviders: () => {
        go(false);
        deps.openAllProviders();
      },
    });
    body.append(
      heading("Connect your AI", "One step left. The free option takes about a minute and needs no card."),
      quick.element,
    );
  }

  function render(): void {
    body.replaceChildren();
    dialog.dataset["step"] = step;
    if (step === "idea") renderIdea();
    else renderConnect();

    dots.replaceChildren();
    for (const name of ["idea", "connect"] as const) {
      const dot = document.createElement("span");
      dot.className = "onboarding-dot";
      if (name === step) dot.dataset["current"] = "true";
      dots.append(dot);
    }

    skip.textContent = step === "idea" ? "Skip" : "Later - just make the project";
    next.hidden = step !== "idea";
    next.textContent = "Build it";
  }

  return {
    open() {
      if (dialog.open) return;
      finished = false;
      step = "idea";
      render();
      dialog.showModal();
      window.adcode.milestones.record("welcome_shown");
      lookForInvite();
      window.addEventListener("focus", onFocus);
      dialog.addEventListener("close", () => window.removeEventListener("focus", onFocus), { once: true });
    },
    close() {
      if (dialog.open) dialog.close();
    },
    isOpen: () => dialog.open,
  };
}
