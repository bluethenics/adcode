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

  const footnote = document.createElement("p");
  footnote.className = "account-panel-foot";
  footnote.textContent = "Opens your browser. We never see your password.";

  panel.append(heading, body, actions, footnote);
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

    if (photo !== null) photo.hidden = true;
    if (glyph !== null) glyph.removeAttribute("hidden");
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !next;
    button.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) place();
  }

  const attempt = (provider: "google" | "github") => {
    google.disabled = true;
    github.disabled = true;
    body.textContent = "Finishing in your browser…";

    void window.adcode.account
      .link(provider)
      .then((outcome) => {
        google.disabled = false;
        github.disabled = false;
        if (outcome.ok) {
          state = outcome.state;
          render();
        } else {
          body.textContent = outcome.message;
        }
      })
      .catch(() => {
        google.disabled = false;
        github.disabled = false;
        body.textContent = "Sign-in didn't complete. Try again.";
      });
  };

  google.addEventListener("click", () => attempt("google"));
  github.addEventListener("click", () => attempt("github"));

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
    body.textContent = `Enter code ${code.userCode} at ${code.verificationUri}`;
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
