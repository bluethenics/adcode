/**
 * The first thing a new install shows.
 *
 * Four steps: pick a look, decide how often ads appear, optionally connect an account,
 * and a short list of the things worth knowing. Every one of them is skippable, and the
 * whole sheet is dismissible, because ADCode's stated promise is that there is no account
 * and no wall on first launch (brief §8.4, and the download page says it in as many
 * words). A tour that has to be completed before the editor is usable would be that wall.
 *
 * The sign-in step is deliberately framed as something to do later. It is offered because
 * an unlinked account's earnings live only on this machine - which is worth knowing on
 * day one rather than after a reinstall - and it is offered *last*, after the person has
 * already made two choices and seen what the app is for.
 *
 * A `<dialog>` opened with `showModal`, like the other sheets: the top layer, Escape, and
 * a focus trap, none of them hand-written.
 */
import { getSetting, type EnumSetting } from "@adcode/settings";
import { themePicker } from "../settings/themePicker.ts";

export interface OnboardingSheet {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface OnboardingDeps {
  /** Current settings, and how to change one. Same pair the settings sheet uses. */
  read: () => Promise<Record<string, boolean | string>>;
  write: (id: string, value: boolean | string) => Promise<Record<string, boolean | string>>;
  /** Opens the account sheet. The tour never signs anybody in itself. */
  openAccount: () => void;
  /** Records that this machine has been welcomed, so it happens once. */
  complete: () => void;
}

const TIPS: { title: string; body: string }[] = [
  {
    title: "Ads wait for a pause",
    body: "A sponsored card never appears while you are typing, debugging, or running something. It waits for a gap, and half of what it pays goes to you.",
  },
  {
    title: "Your earnings are a ledger",
    body: "Every verified view is a row you can read, with the exact amount. Corrections appear as their own row rather than quietly editing an old one.",
  },
  {
    title: "Bring your own AI",
    body: "Connect any provider and key you already have. Every change the agent proposes is shown as a diff you approve before it touches a file.",
  },
];

/** The frequency options, read from the schema so they cannot drift from Settings. */
function frequencyOptions(): readonly { value: string; label: string; detail?: string }[] {
  const setting = getSetting("adcode.ads.frequency");
  return setting?.kind === "enum" ? (setting as EnumSetting).options : [];
}

export function createOnboardingSheet(deps: OnboardingDeps): OnboardingSheet {
  const dialog = document.createElement("dialog");
  dialog.className = "onboarding";

  let step = 0;
  let values: Record<string, boolean | string> = {};

  const body = document.createElement("div");
  body.className = "onboarding-body";

  const dots = document.createElement("div");
  dots.className = "onboarding-dots";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "ghost-button";
  back.textContent = "Back";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "chat-send";

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "onboarding-skip";
  skip.textContent = "Skip";

  const footer = document.createElement("div");
  footer.className = "onboarding-footer";
  footer.append(skip, dots, back, next);

  dialog.append(body, footer);
  document.body.append(dialog);

  const finish = (): void => {
    deps.complete();
    dialog.close();
  };

  skip.addEventListener("click", finish);
  back.addEventListener("click", () => {
    step = Math.max(0, step - 1);
    render();
  });
  next.addEventListener("click", () => {
    if (step >= 3) {
      finish();
      return;
    }
    step += 1;
    render();
  });

  // Escape closes a `<dialog>` for free, and closing it any way at all counts as done:
  // being asked the same four questions on every launch is worse than missing them once.
  dialog.addEventListener("close", () => deps.complete());

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

  function renderTheme(): void {
    body.append(
      heading("Make it yours", "Three looks, and the one the website wears. You can change this whenever you like."),
      themePicker(
        (getSetting("adcode.appearance.theme") as EnumSetting | undefined)?.options ?? [],
        String(values["adcode.appearance.theme"] ?? "system"),
        false,
        (choice) => {
          void deps.write("adcode.appearance.theme", choice).then((updated) => {
            values = updated;
            render();
          });
        },
      ),
    );
  }

  function renderFrequency(): void {
    const group = document.createElement("div");
    group.className = "onboarding-choices";

    for (const option of frequencyOptions()) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "onboarding-choice";
      card.setAttribute("role", "radio");
      card.ariaChecked = String(values["adcode.ads.frequency"] === option.value);

      const label = document.createElement("strong");
      label.textContent = option.label;

      const detail = document.createElement("small");
      detail.textContent = option.detail ?? "";

      card.append(label, detail);
      card.addEventListener("click", () => {
        void deps.write("adcode.ads.frequency", option.value).then((updated) => {
          values = updated;
          render();
        });
      });
      group.append(card);
    }

    body.append(
      heading(
        "How often should ads appear?",
        "Never during typing or debugging, whichever you pick. Off is a real option - the editor is free either way.",
      ),
      group,
    );
  }

  function renderAccount(): void {
    const actions = document.createElement("div");
    actions.className = "onboarding-actions";

    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "chat-send";
    connect.textContent = "Connect an account";
    connect.addEventListener("click", () => {
      // The tour hands off rather than signing anybody in itself: the account sheet
      // already knows how to do this, and two implementations of sign-in is one too many.
      deps.openAccount();
      finish();
    });

    const later = document.createElement("button");
    later.type = "button";
    later.className = "ghost-button";
    later.textContent = "I'll do this later";
    later.addEventListener("click", () => {
      step = 3;
      render();
    });

    actions.append(connect, later);

    body.append(
      heading(
        "Connect an account, or don't",
        "You are already signed in anonymously and already earning - nothing here is required. Connecting one means your balance follows you to another machine, and survives a reinstall.",
      ),
      actions,
    );
  }

  function renderTips(): void {
    const list = document.createElement("div");
    list.className = "onboarding-tips";

    for (const tip of TIPS) {
      const card = document.createElement("div");
      card.className = "onboarding-tip";

      const title = document.createElement("strong");
      title.textContent = tip.title;

      const text = document.createElement("p");
      text.textContent = tip.body;

      card.append(title, text);
      list.append(card);
    }

    body.append(heading("Three things worth knowing", "Then you are done."), list);
  }

  function render(): void {
    body.replaceChildren();

    if (step === 0) renderTheme();
    else if (step === 1) renderFrequency();
    else if (step === 2) renderAccount();
    else renderTips();

    dots.replaceChildren();
    for (let index = 0; index < 4; index += 1) {
      const dot = document.createElement("span");
      dot.className = "onboarding-dot";
      if (index === step) dot.dataset["current"] = "true";
      dots.append(dot);
    }

    back.hidden = step === 0;
    skip.hidden = step === 3;
    next.textContent = step === 3 ? "Start coding" : "Continue";
  }

  return {
    open() {
      if (dialog.open) return;
      void deps.read().then((current) => {
        values = current;
        step = 0;
        render();
        dialog.showModal();
      });
    },
    close() {
      if (dialog.open) dialog.close();
    },
    isOpen: () => dialog.open,
  };
}
