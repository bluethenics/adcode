/**
 * The account button in the title bar, and the panel it opens.
 *
 * Anonymous, it is a bust outline and the panel offers Google and GitHub. Linked, it
 * becomes the provider's photo and the panel says whose account this is.
 *
 * It never blocks anything. §8.4 promises first launch has no wall, and earnings accrue
 * whether or not anyone ever presses this. What signing in buys is keeping the money -
 * reaching it from the web dashboard, and withdrawing it when withdrawals open. The copy
 * says exactly that and no more, because "sign in to earn" would be false and would stop
 * being believed the first time someone watched their balance rise while signed out.
 */
import type { AccountState } from "../../shared/api.ts";

export interface AccountMenu {
  isOpen(): boolean;
  close(): void;
}

export function createAccountMenu(button: HTMLButtonElement, host: HTMLElement): AccountMenu {
  const photo = document.getElementById("account-photo") as HTMLImageElement | null;
  const glyph = document.getElementById("account-glyph");

  const panel = document.createElement("div");
  panel.className = "account-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Account");
  panel.hidden = true;

  const heading = document.createElement("h2");
  heading.className = "account-panel-title";

  const body = document.createElement("p");
  body.className = "account-panel-body";

  const actions = document.createElement("div");
  actions.className = "account-panel-actions";

  const google = document.createElement("button");
  google.type = "button";
  google.className = "account-provider";
  google.textContent = "Continue with Google";

  const github = document.createElement("button");
  github.type = "button";
  github.className = "account-provider";
  github.textContent = "Continue with GitHub";

  actions.append(google, github);

  /**
   * The GitHub code, shown as something you can read and copy.
   *
   * It used to be a sentence - "Enter code A9B0-E0C1 at https://github.com/…" - which is
   * everything you need and none of it findable at a glance, while a browser tab is already
   * open waiting for the code. Large, monospaced, and one click to copy.
   */
  const codeBox = document.createElement("div");
  codeBox.className = "account-device-code";
  codeBox.hidden = true;

  const codeValue = document.createElement("code");
  codeValue.className = "account-device-code-value";

  const codeCopy = document.createElement("button");
  codeCopy.type = "button";
  codeCopy.className = "account-device-code-copy";
  codeCopy.textContent = "Copy";

  const codeHint = document.createElement("p");
  codeHint.className = "account-device-code-hint";

  codeBox.append(codeValue, codeCopy, codeHint);

  /** Shown only while a sign-in is waiting on the browser. */
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "account-cancel";
  cancel.textContent = "Cancel";
  cancel.hidden = true;

  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "account-signout";
  signOut.textContent = "Sign out";
  signOut.hidden = true;

  const footnote = document.createElement("p");
  footnote.className = "account-panel-foot";
  footnote.textContent = "Opens your browser. We never see your password.";

  panel.append(heading, body, codeBox, actions, cancel, signOut, footnote);
  host.append(panel);

  let state: AccountState = { state: "anonymous" };
  let open = false;

  function place(): void {
    const rect = button.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + 6)}px`;
    // Right-aligned to the button, then clamped so it cannot hang off a narrow window.
    const right = Math.max(8, Math.round(window.innerWidth - rect.right));
    panel.style.right = `${right}px`;
  }

  function render(): void {
    if (state.state === "unavailable") {
      button.hidden = true;
      return;
    }

    button.hidden = false;

    if (state.state === "linked") {
      const who = state.displayName ?? state.email ?? "your account";
      button.title = `Signed in as ${who}`;
      button.setAttribute("aria-label", button.title);

      heading.textContent = who;
      body.textContent =
        state.email !== null && state.email !== who
          ? `${state.email} — your earnings follow this account.`
          : "Your earnings follow this account.";
      actions.hidden = true;
      footnote.hidden = true;
      codeBox.hidden = true;
      cancel.hidden = true;
      signOut.hidden = false;

      if (photo !== null && state.photoUrl !== null) {
        photo.src = state.photoUrl;
        photo.hidden = false;
        if (glyph !== null) glyph.setAttribute("hidden", "");
      }
      return;
    }

    button.title = "Sign in";
    button.setAttribute("aria-label", "Sign in");
    heading.textContent = "Keep your earnings";
    body.textContent =
      "You're already earning — no account needed for that. Sign in to see your balance on the web and to withdraw it later.";
    actions.hidden = false;
    footnote.hidden = false;
    signOut.hidden = true;

    if (photo !== null) photo.hidden = true;
    if (glyph !== null) glyph.removeAttribute("hidden");
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !next;
    button.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) place();
  }

  /** Back to the state the panel is in when nothing is happening. */
  const idle = (): void => {
    google.disabled = false;
    github.disabled = false;
    cancel.hidden = true;
    codeBox.hidden = true;
  };

  const attempt = (provider: "google" | "github") => {
    google.disabled = true;
    github.disabled = true;
    cancel.hidden = false;
    codeBox.hidden = true;
    body.textContent =
      provider === "google"
        ? "Waiting for you to finish in your browser…"
        : "Getting a code from GitHub…";

    void window.adcode.account
      .link(provider)
      .then((outcome) => {
        idle();
        if (outcome.ok) {
          state = outcome.state;
          render();
        } else {
          body.textContent = outcome.message;
        }
      })
      .catch(() => {
        idle();
        body.textContent = "Sign-in didn't complete. Try again.";
      });
  };

  google.addEventListener("click", () => attempt("google"));
  github.addEventListener("click", () => attempt("github"));

  cancel.addEventListener("click", () => {
    // Optimistic: the flow resolves as cancelled a moment later and calls `idle()` itself,
    // but the button has to stop looking stuck the instant it is pressed.
    idle();
    body.textContent = "Sign-in cancelled.";
    void window.adcode.account.cancelLink();
  });

  codeCopy.addEventListener("click", () => {
    void window.adcode.clipboard.writeText(codeValue.textContent ?? "");
    codeCopy.textContent = "Copied";
    setTimeout(() => {
      codeCopy.textContent = "Copy";
    }, 1500);
  });

  signOut.addEventListener("click", () => {
    // One confirmation, because it is not obvious that signing out of a linked account is
    // recoverable and signing out of an anonymous one is not.
    const who = state.state === "linked" ? (state.email ?? state.displayName ?? "this account") : "";
    const ok = window.confirm(
      `Sign out of ${who}?

Your earnings stay with the account. Sign in with the same provider on this or any machine to get them back.`,
    );
    if (!ok) return;

    signOut.disabled = true;
    void window.adcode.account
      .signOut()
      .then((next) => {
        state = next;
        render();
      })
      .finally(() => {
        signOut.disabled = false;
      });
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!open);
  });

  // Dismissal: a click anywhere else, or Escape. Both converge on `setOpen(false)` so
  // there is no route out that leaves `aria-expanded` lying.
  document.addEventListener("pointerdown", (event) => {
    if (!open) return;
    if (panel.contains(event.target as Node) || button.contains(event.target as Node)) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (open && event.key === "Escape") {
      setOpen(false);
      button.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (open) place();
  });

  window.adcode.account.onDeviceCode((code) => {
    body.textContent = "Type this code into the page that just opened:";
    codeValue.textContent = code.userCode;
    codeHint.textContent = code.verificationUri;
    codeBox.hidden = false;
  });

  window.adcode.account.onChanged((next) => {
    state = next;
    render();
  });

  void window.adcode.account.status().then((next) => {
    state = next;
    render();
  });

  render();

  return {
    isOpen: () => open,
    close: () => setOpen(false),
  };
}
