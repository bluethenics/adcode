import type { AccountMenu } from "../workbench/accountMenu.ts";
import { createAccountBackdrop } from "./accountBackdrop.ts";

/** How long an account check may take before the gate shows "Checking your account". */
export const SLOW_CHECK_MS = 700;

/** Authentication and server-side verification remain required, independently of the tour. */
export function createAccountGate(menu: AccountMenu, ready: () => void, required: Promise<boolean> = Promise.resolve(true)) {
  const dialog = document.createElement("dialog");
  dialog.className = "account-gate";
  dialog.setAttribute("aria-labelledby", "account-gate-title");
  const backdrop = createAccountBackdrop(dialog);
  const brand = document.createElement("div"); brand.className = "account-gate-brand"; brand.textContent = "ADCode";
  const content = document.createElement("section"); content.className = "account-gate-content";
  const title = document.createElement("h1"); title.id = "account-gate-title"; title.textContent = "Checking your account";
  const detail = document.createElement("p"); detail.className = "account-gate-detail";
  const mount = document.createElement("div"); mount.className = "account-gate-form";
  const status = document.createElement("p"); status.className = "account-gate-status"; status.setAttribute("role", "status");
  const retry = document.createElement("button"); retry.type = "button"; retry.className = "account-gate-retry"; retry.textContent = "Try again"; retry.hidden = true;
  // A sign-in that shared no email address (GitHub with a private email, reported on 2.4.10)
  // has nowhere to receive a verification link. Adding one links an email sign-in to the same
  // account, and the next check sends the link there.
  const addEmail = document.createElement("form"); addEmail.className = "account-gate-add-email"; addEmail.hidden = true;
  const emailInput = document.createElement("input"); emailInput.type = "email"; emailInput.required = true; emailInput.autocomplete = "email"; emailInput.placeholder = "you@example.com"; emailInput.setAttribute("aria-label", "Email address");
  const passwordInput = document.createElement("input"); passwordInput.type = "password"; passwordInput.required = true; passwordInput.minLength = 6; passwordInput.autocomplete = "new-password"; passwordInput.placeholder = "Password (6+ characters)"; passwordInput.setAttribute("aria-label", "Password for email sign-in");
  const addButton = document.createElement("button"); addButton.type = "submit"; addButton.textContent = "Add email and send link";
  addEmail.append(emailInput, passwordInput, addButton);
  // The way out. A gate nobody could close sent everyone whose verification email never came
  // (100 of 346 reports) away with no editor at all. The editor, previews, a person's own keys and
  // installed CLIs need no account; included AI still asks for verification on the server.
  const later = document.createElement("button"); later.type = "button"; later.className = "account-gate-later"; later.textContent = "Look around first - sign in later";
  content.append(title, detail, addEmail, mount, status, retry, later);
  dialog.append(backdrop.element, brand, content);
  document.body.append(dialog);
  let checking = false, queued = false, verified = false, version = 0, timer: number | undefined, slow: number | undefined;
  /** The person got into the editor this launch: a verified account, or "sign in later". */
  let unlocked = false;
  const waiting: (() => void)[] = [];
  dialog.addEventListener("cancel", event => event.preventDefault());
  addEmail.addEventListener("submit", event => {
    event.preventDefault();
    addButton.disabled = true; status.textContent = "Adding your email...";
    void window.adcode.account.linkEmail(emailInput.value.trim(), passwordInput.value).then(outcome => {
      passwordInput.value = "";
      status.textContent = outcome.ok ? "Email added. Sending your verification link..." : outcome.message;
      if (outcome.ok) void check();
    }).finally(() => { addButton.disabled = false; });
  });
  function open(step: string) {
    clearTimeout(slow);
    dialog.dataset["step"] = step;
    if (!dialog.open) { dialog.showModal(); backdrop.activate(); }
    if (step !== "checking") menu.attachTo(mount);
  }
  /*
   * "Checking your account" only when the check is slow. A returning, verified account clears
   * in well under a second, and putting a full-screen gate up for that blink - then taking it
   * down, and on launch putting it up again when the verification answer itself announced an
   * account change - was the flicker people reported. Under SLOW_CHECK_MS nothing is shown.
   */
  function checkingSoon() {
    clearTimeout(slow);
    if (dialog.open) return;
    slow = window.setTimeout(() => {
      if (!checking || dialog.open) return;
      title.textContent = "Checking your account"; detail.textContent = ""; status.textContent = ""; retry.hidden = true;
      open("checking");
    }, SLOW_CHECK_MS);
  }
  function unlock() {
    clearTimeout(timer); clearTimeout(slow);
    if (dialog.open) { menu.attachTo(null); dialog.close(); backdrop.deactivate(); }
    const first = !unlocked;
    unlocked = true;
    if (first) ready();
    waiting.splice(0).forEach(resolve => resolve());
  }
  /**
   * `quiet`: the person is already in (an account change after unlocking). Only an answer that
   * needs them - signed out, or an email still to confirm - puts the gate back up; a network
   * blip or the same verified account changes nothing on screen.
   */
  async function check(quiet = false) {
    queued = true;
    if (checking) return;
    checking = true;
    clearTimeout(timer);
    if (!quiet) checkingSoon();
    try {
      // Verification can broadcast an account change during this request. Queue a fresh
      // check rather than dropping the notification or unlocking from a stale result.
      do {
        queued = false;
        const request = version;
        try {
          const account = await window.adcode.account.status();
          if (request !== version) continue;
          if (account.state === "unavailable" && quiet && unlocked) break;
          if (account.state !== "linked") {
            verified = false; addEmail.hidden = true; retry.hidden = account.state !== "unavailable";
            title.textContent = "Sign in to ADCode";
            detail.textContent = "Your account keeps your AI and conversations together.";
            status.textContent = account.state === "unavailable" ? "Could not connect. Check your connection and try again." : "";
            open("signin"); continue;
          }
          const result = await window.adcode.account.verification(false);
          if (request !== version) continue;
          // No yes or no came back: the check itself failed (offline, a timeout). That is not
          // "unverified", and must not ask somebody already verified to confirm their email.
          if (typeof result.verified !== "boolean") {
            if (quiet && unlocked) break;
            throw new Error(result.message);
          }
          verified = result.verified;
          if (verified) { unlock(); continue; }
          retry.hidden = true;
          addEmail.hidden = Boolean(account.email);
          title.textContent = addEmail.hidden ? "Confirm your email" : "Add an email to finish";
          detail.textContent = addEmail.hidden
            ? `Signed in as ${account.email}. Open your ADCode verification email, then return here.`
            : `Signed in as ${account.displayName ?? "your account"}, but your sign-in didn't share an email address. Add one and we'll send a link to confirm it - it stays on this same account.`;
          status.textContent = result.message;
          open("verify");
        } catch {
          if (request !== version) continue;
          if (quiet && unlocked) break;
          verified = false;
          title.textContent = "Connect to your account";
          detail.textContent = "Check your connection, then try again.";
          status.textContent = "We could not check your account.";
          retry.hidden = false; open("error");
        }
      } while (queued);
    } finally {
      checking = false;
      clearTimeout(slow);
      if (dialog.open && !verified) timer = window.setTimeout(() => { void check(); }, 5000);
    }
  }
  retry.addEventListener("click", () => { void check(); });
  later.addEventListener("click", () => {
    // Skipped for this launch: no reopening on a token refresh. The account menu signs in later.
    guarding = false; verified = true; unlock();
  });
  window.addEventListener("focus", () => { if (dialog.open) void check(); });
  let guarding = true;
  window.adcode.account.onChanged(() => {
    if (!guarding) return;
    version++;
    // An open gate updates in place; once the person is in, the change is checked quietly.
    void check(!dialog.open && unlocked);
  });
  // A source checkout run for automation may switch the gate off (see PlatformInfo.accountGate).
  void required.catch(() => true).then((on) => {
    if (on) { void check(); return; }
    guarding = false; verified = true; unlock();
  });
  return { wait: () => verified && !dialog.open ? Promise.resolve() : new Promise<void>(resolve => waiting.push(resolve)), isOpen: () => dialog.open };
}
