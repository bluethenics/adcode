/**
 * The account button in the title bar, and the panel it opens.
 *
 * Anonymous, it is a bust outline and the panel offers Google and GitHub. Linked, it
 * becomes the provider's photo and the panel says whose account this is.
 *
 * It never blocks anything. §8.4 promises first launch has no wall, and earnings accrue
 * whether or not anyone ever presses this. What signing in buys is keeping the money -
 * reaching it from the web dashboard, and withdrawing it from there. The copy
 * says exactly that and no more, because "sign in to earn" would be false and would stop
 * being believed the first time someone watched their balance rise while signed out.
 */
import type { ConfirmDialog } from "../dialogs/confirmDialog.ts";
import type { AccountState, LinkOutcome } from "../../shared/api.ts";

export interface AccountMenu {
  isOpen(): boolean;
  close(): void;
}

export function createAccountMenu(
  button: HTMLButtonElement,
  host: HTMLElement,
  confirm: ConfirmDialog,
): AccountMenu {
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

  /**
   * Shown only when a link was refused because the account already exists.
   *
   * The refusal used to end the conversation - it advised signing in with that account
   * instead, and offered no way to. This is that way. It appears only when there is
   * something to weigh: with nothing unclaimed on this machine, the main process signs
   * in without asking and this button is never needed.
   */
  const signInInstead = document.createElement("button");
  signInInstead.type = "button";
  signInInstead.className = "account-provider account-signin-instead";
  signInInstead.textContent = "Sign in to that account";
  signInInstead.hidden = true;

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

  /*
   * Above the providers, not below them.
   *
   * When this button is showing, it is the answer - the two provider buttons underneath
   * are the thing that just failed. Reading order should put the way forward first, and
   * the accent fill separates it from the row of neutral buttons it would otherwise be
   * mistaken for a third member of.
   */
  panel.append(heading, body, codeBox, signInInstead, actions, cancel, signOut, footnote);
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
      signInInstead.hidden = true;
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
    signInInstead.hidden = true;
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
    signInInstead.disabled = false;
    cancel.hidden = true;
    codeBox.hidden = true;
  };

  /**
   * Show whatever an attempt came back as.
   *
   * Three outcomes, not two: as well as done and refused there is now "the credential is
   * fine, but the account already exists and switching to it costs this machine's
   * unclaimed balance", which is a question rather than a failure and needs a button to
   * answer it.
   */
  const settle = (outcome: LinkOutcome): void => {
    idle();

    if (outcome.ok) {
      signInInstead.hidden = true;
      state = outcome.state;
      render();
      return;
    }

    body.textContent = outcome.message;
    signInInstead.hidden = !("decide" in outcome);
  };

  const attempt = (provider: "google" | "github") => {
    google.disabled = true;
    github.disabled = true;
    signInInstead.hidden = true;
    cancel.hidden = false;
    codeBox.hidden = true;
    body.textContent =
      provider === "google"
        ? "Waiting for you to finish in your browser…"
        : "Getting a code from GitHub…";

    void window.adcode.account
      .link(provider)
      .then(settle)
      .catch(() => {
        idle();
        signInInstead.hidden = true;
        body.textContent = "Sign-in didn't complete. Try again.";
      });
  };

  signInInstead.addEventListener("click", () => {
    signInInstead.disabled = true;
    google.disabled = true;
    github.disabled = true;
    body.textContent = "Signing in…";

    void window.adcode.account
      .signInInstead()
      .then(settle)
      .catch(() => {
        idle();
        signInInstead.hidden = true;
        body.textContent = "Sign-in didn't complete. Try again.";
      });
  });

  google.addEventListener("click", () => attempt("google"));
  github.addEventListener("click", () => attempt("github"));

  cancel.addEventListener("click", () => {
    // Optimistic: the flow resolves as cancelled a moment later and calls `idle()` itself,
    // but the button has to stop looking stuck the instant it is pressed.
    idle();
    signInInstead.hidden = true;
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
    // recoverable and signing out of an anonymous one is not. The app's own dialog, not
    // `window.confirm` - that one is unstyled, and in this Electron it has been measured
    // returning without waiting for an answer at all.
    const who = state.state === "linked" ? (state.email ?? state.displayName ?? "this account") : "this account";

    void confirm
      .ask({
        title: `Sign out of ${who}?`,
        body: "Your earnings stay with the account. Sign in with the same provider, on this or any machine, to get them back.",
        confirmLabel: "Sign out",
      })
      .then((ok) => {
        if (!ok) return;

        signOut.disabled = true;
        return window.adcode.account
          .signOut()
          .then((next) => {
            state = next;
            render();
          })
          .finally(() => {
            signOut.disabled = false;
          });
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
