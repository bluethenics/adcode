import type { AccountMenu } from "../workbench/accountMenu.ts";
import { createAccountBackdrop } from "./accountBackdrop.ts";

/** Authentication and server-side verification remain required, independently of the tour. */
export function createAccountGate(menu: AccountMenu, ready: () => void) {
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
  content.append(title, detail, addEmail, mount, status, retry);
  dialog.append(backdrop.element, brand, content);
  document.body.append(dialog);
  let checking = false, queued = false, verified = false, version = 0, timer: number | undefined;
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
    dialog.dataset["step"] = step;
    if (!dialog.open) { dialog.showModal(); backdrop.activate(); }
    if (step !== "checking") menu.attachTo(mount);
  }
  function unlock() {
    clearTimeout(timer); menu.attachTo(null); dialog.close(); backdrop.deactivate();
    ready(); waiting.splice(0).forEach(resolve => resolve());
  }
  async function check() {
    queued = true;
    if (checking) return;
    checking = true;
    clearTimeout(timer);
    try {
      // Verification can broadcast an account change during this request. Queue a fresh
      // check rather than dropping the notification or unlocking from a stale result.
      do {
        queued = false;
        const request = version;
        try {
          const account = await window.adcode.account.status();
          if (request !== version) continue;
          retry.hidden = true;
          if (account.state !== "linked") {
            verified = false; addEmail.hidden = true;
            title.textContent = "Sign in to ADCode";
            detail.textContent = "Your account keeps your AI and conversations together.";
            status.textContent = account.state === "unavailable" ? "Could not connect. Check your connection and try again." : "";
            retry.hidden = account.state !== "unavailable";
            open("signin"); continue;
          }
          const result = await window.adcode.account.verification(false);
          if (request !== version) continue;
          verified = result.verified === true;
          if (verified) { unlock(); continue; }
          addEmail.hidden = Boolean(account.email);
          title.textContent = addEmail.hidden ? "Confirm your email" : "Add an email to finish";
          detail.textContent = addEmail.hidden
            ? `Signed in as ${account.email}. Open your ADCode verification email, then return here.`
            : `Signed in as ${account.displayName ?? "your account"}, but your sign-in didn't share an email address. Add one and we'll send a link to confirm it - it stays on this same account.`;
          status.textContent = result.message;
          open("verify");
        } catch {
          if (request !== version) continue;
          verified = false;
          title.textContent = "Connect to your account";
          detail.textContent = "Check your connection, then try again.";
          status.textContent = "We could not check your account.";
          retry.hidden = false; open("error");
        }
      } while (queued);
    } finally {
      checking = false;
      if (dialog.open && !verified) timer = window.setTimeout(() => { void check(); }, 5000);
    }
  }
  retry.addEventListener("click", () => { void check(); });
  window.addEventListener("focus", () => { if (dialog.open) void check(); });
  window.adcode.account.onChanged(() => {
    version++; verified = false;
    title.textContent = "Checking your account"; status.textContent = "";
    open("checking"); void check();
  });
  // Avoid flashing the sign-in form for an already verified returning account.
  open("checking"); void check();
  return { wait: () => verified && !dialog.open ? Promise.resolve() : new Promise<void>(resolve => waiting.push(resolve)), isOpen: () => dialog.open };
}
