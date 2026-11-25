/**
 * The banned screen: covers the whole window while the server has banned this account.
 *
 * Same words as the website (packages/help/src/accountBan.ts). A modal dialog on the top layer,
 * so it sits over the workbench, the sign-in gate and every popup, and Escape cannot close it.
 * It leaves only by the account being unbanned: "Check again" asks the server now, and the main
 * process asks by itself once a minute (main/accountBan.ts). There is no sign-out here on
 * purpose - a banned account that could sign out and carry on anonymously would not be banned.
 * The appeal goes to the support address, with the account id in the message.
 *
 * Shared by the desktop app and the web version, whose renderer is this same code.
 */
import { ACCOUNT_BANNED_COPY, appealMailto } from "@adcode/help/accountBan";
import type { AccountBanState } from "../shared/api.ts";

export interface AccountBanScreen {
  show(state: AccountBanState): void;
  readonly element: HTMLDialogElement;
}

export function createAccountBanScreen(): AccountBanScreen {
  const dialog = document.createElement("dialog");
  dialog.className = "account-ban";
  dialog.setAttribute("aria-labelledby", "account-ban-title");
  dialog.setAttribute("aria-describedby", "account-ban-message");
  dialog.setAttribute("data-testid", "account-banned");

  const content = document.createElement("section"); content.className = "account-ban-content";
  const mark = document.createElement("span"); mark.className = "account-ban-mark"; mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
  const title = document.createElement("h1"); title.id = "account-ban-title"; title.textContent = ACCOUNT_BANNED_COPY.title;
  const message = document.createElement("p"); message.id = "account-ban-message"; message.className = "account-ban-message"; message.textContent = ACCOUNT_BANNED_COPY.message;
  const kept = document.createElement("p"); kept.className = "account-ban-kept"; kept.textContent = ACCOUNT_BANNED_COPY.kept;
  const id = document.createElement("p"); id.className = "account-ban-id";
  const actions = document.createElement("div"); actions.className = "account-ban-actions";
  const appeal = document.createElement("a"); appeal.className = "account-ban-primary"; appeal.target = "_blank"; appeal.rel = "noopener"; appeal.textContent = ACCOUNT_BANNED_COPY.emailSupport;
  const again = document.createElement("button"); again.type = "button"; again.className = "account-ban-secondary"; again.textContent = ACCOUNT_BANNED_COPY.checkAgain;
  const status = document.createElement("p"); status.className = "account-ban-status"; status.setAttribute("role", "status");
  actions.append(appeal, again);
  content.append(mark, title, message, kept, id, actions, status);
  dialog.append(content);
  document.body.append(dialog);

  dialog.addEventListener("cancel", (event) => event.preventDefault());

  const show = (state: AccountBanState): void => {
    if (!state.banned) {
      if (dialog.open) dialog.close();
      dialog.dataset["banned"] = "false";
      return;
    }
    dialog.dataset["banned"] = "true";
    id.textContent = state.uid === null ? "" : `Account ID ${state.uid}`;
    id.hidden = state.uid === null;
    appeal.href = appealMailto(state.uid);
    // Re-open on top: a dialog opened after this one (the sign-in gate) would otherwise cover it.
    if (dialog.open) dialog.close();
    dialog.showModal();
    again.focus();
  };

  // Any modal opened later lands on the top layer above this one (a shortcut can still open
  // one). While banned, this one goes back on top of it.
  new MutationObserver((changes) => {
    if (dialog.dataset["banned"] !== "true") return;
    if (changes.some((change) => change.target !== dialog && change.target instanceof HTMLDialogElement && change.target.open)) { dialog.close(); dialog.showModal(); }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });

  again.addEventListener("click", () => {
    again.disabled = true;
    status.textContent = "Checking with ADCode…";
    void window.adcode.account.ban(true).then((state) => {
      status.textContent = state.banned ? "Still banned. If you've written to support, they'll reply by email." : "";
      show(state);
    }).catch(() => { status.textContent = "Couldn't reach ADCode. Check your connection and try again."; })
      .finally(() => { again.disabled = false; });
  });

  return { show, element: dialog };
}

/** Mount once per window: follows the main process's answer from the start. */
export function mountAccountBan(): AccountBanScreen {
  const screen = createAccountBanScreen();
  window.adcode.account.onBan((state) => screen.show(state));
  void window.adcode.account.ban(false).then((state) => screen.show(state)).catch(() => undefined);
  return screen;
}
