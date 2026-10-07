/**
 * Invite & earn: your link, who joined with it, what it earned, and - for a new account -
 * a box for the code someone sent you.
 *
 * Everything shown comes from the server's view through `inviteModel.ts`; this module only
 * builds the elements and wires the buttons. Sharing goes through main, which builds the
 * URL from this account's own code - the renderer can name X, Threads or email, never a URL.
 */
import type { ReferralView } from "../../shared/api.ts";
import { inviteLink, withBuiltWithLine } from "../../shared/invite.ts";
import { claimMessage, earnedLine, howItWorks, invitedLine, namePreview, peopleLine } from "./inviteModel.ts";

export interface InvitePanelDeps {
  /** A short message in the status bar, for copy confirmations. */
  readonly notify: (text: string) => void;
  /** The open project's folder, for the "Built with ADCode" line. Null with no project open. */
  readonly workspaceRoot: () => string | null;
}

export interface InvitePanel {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  /** Reload from the server, e.g. after a claim made elsewhere. */
  refresh(): Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createInvitePanel(deps: InvitePanelDeps): InvitePanel {
  const card = el("section", "invite-card");
  card.setAttribute("aria-label", "Invite and earn");
  card.dataset["state"] = "loading";

  const hero = el("header", "invite-hero");
  hero.append(
    el("p", "invite-kicker", "Invite & earn"),
    el("h2", "invite-title", "Bring people to ADCode. Earn from what they bring in."),
  );

  const linkRow = el("div", "invite-link-row");
  const link = el("code", "invite-link", "…");
  const copy = el("button", "chat-send invite-copy", "Copy link");
  copy.type = "button";
  linkRow.append(link, copy);

  const share = el("div", "invite-share");
  const shareButton = (label: string, target: "x" | "threads" | "email"): HTMLButtonElement => {
    const button = el("button", "ghost-button invite-share-button", label);
    button.type = "button";
    button.dataset["target"] = target;
    button.addEventListener("click", () => void window.adcode.referrals.share(target));
    return button;
  };
  share.append(shareButton("Post on X", "x"), shareButton("Post on Threads", "threads"), shareButton("Email it", "email"));

  const people = el("p", "invite-people");
  const earned = el("p", "invite-earned");

  const how = el("ul", "invite-how");

  const invited = el("p", "invite-invited");

  const claim = el("form", "invite-claim");
  const claimLabel = el("label", "invite-claim-label", "Got an invite code?");
  const claimInput = el("input", "invite-claim-input");
  claimInput.type = "text";
  claimInput.placeholder = "Paste the code or the invite link";
  claimInput.autocomplete = "off";
  claimInput.spellcheck = false;
  claimInput.id = "invite-claim-input";
  claimLabel.htmlFor = claimInput.id;
  const claimButton = el("button", "ghost-button invite-claim-button", "Add");
  claimButton.type = "submit";
  const claimStatus = el("p", "invite-claim-status");
  claimStatus.setAttribute("role", "status");
  const claimRow = el("div", "invite-claim-row");
  claimRow.append(claimInput, claimButton);
  claim.append(claimLabel, claimRow, claimStatus);

  const nameRow = el("label", "invite-name");
  const nameToggle = el("input", "invite-name-toggle");
  nameToggle.type = "checkbox";
  nameRow.append(nameToggle, document.createTextNode(" Show my first name on my invite page"));
  const nameNote = el("p", "invite-name-preview");

  /*
   * "Built with ADCode", on request. New projects start empty on purpose, so the line goes
   * in only when somebody presses this - and then it is a link people who see the project
   * can follow, carrying this account's code.
   */
  const badge = el("div", "invite-badge");
  const badgeButton = el("button", "ghost-button invite-badge-button", "Add “Built with ADCode” to this project's README");
  badgeButton.type = "button";
  const badgeStatus = el("p", "invite-badge-status");
  badgeStatus.setAttribute("role", "status");
  badge.append(badgeButton, badgeStatus);

  const unavailable = el("p", "invite-unavailable", "Invites aren't available right now. Try again in a little while.");

  card.append(hero, linkRow, share, people, earned, how, invited, claim, nameRow, nameNote, badge, unavailable);

  let view: ReferralView | null = null;
  let loading: Promise<void> | null = null;

  function render(): void {
    card.dataset["state"] = view === null ? "unavailable" : "ready";
    unavailable.hidden = view !== null;
    for (const node of [linkRow, share, people, earned, how, invited, claim, nameRow, nameNote, badge]) node.hidden = view === null;
    if (view === null) return;

    link.textContent = view.link.replace(/^https:\/\//, "");
    link.title = view.link;
    people.textContent = peopleLine(view);
    const money = earnedLine(view);
    earned.textContent = money ?? "";
    earned.hidden = money === null;
    how.replaceChildren(...howItWorks(view.rates).map((line) => el("li", "invite-how-line", line)));
    const invitedText = invitedLine(view);
    invited.textContent = invitedText ?? "";
    invited.hidden = invitedText === null;
    claim.hidden = !view.canClaim;
    nameToggle.checked = view.showName;
    nameNote.textContent = namePreview(view);
    badge.hidden = deps.workspaceRoot() === null;
  }

  badgeButton.addEventListener("click", () => {
    const root = deps.workspaceRoot();
    if (view === null || root === null) return;
    const readme = `${root.replace(/[\\/]+$/, "")}/README.md`;
    const link = inviteLink(view.code, "readme");
    badgeButton.disabled = true;
    void (async () => {
      let current: string | null = null;
      try {
        current = (await window.adcode.files.read(readme)).text;
      } catch {
        current = null; // No README yet: the line becomes one.
      }
      const next = withBuiltWithLine(current, link);
      if (next === null) {
        badgeStatus.textContent = "This project's README already says it was built with ADCode.";
      } else {
        const saved = await window.adcode.files.write(readme, next).catch(() => ({ ok: false }));
        badgeStatus.textContent = saved.ok ? "Added to README.md." : "Couldn't write README.md.";
      }
      badgeButton.disabled = false;
    })();
  });

  async function refresh(): Promise<void> {
    loading ??= window.adcode.referrals.get().then((next) => {
      view = next;
      render();
    }, () => {
      view = null;
      render();
    }).finally(() => {
      loading = null;
    });
    return loading;
  }

  copy.addEventListener("click", () => {
    if (view === null) return;
    void window.adcode.clipboard.writeText(view.link).then(() => {
      copy.textContent = "Copied";
      deps.notify("Invite link copied. Send it to someone who'd like ADCode.");
      window.setTimeout(() => {
        copy.textContent = "Copy link";
      }, 1500);
    });
  });

  claim.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = claimInput.value;
    if (text.trim().length === 0) return;
    claimButton.disabled = true;
    claimStatus.textContent = "Checking…";
    void window.adcode.referrals.claim(text).then((result) => {
      claimButton.disabled = false;
      claimStatus.textContent = claimMessage(result);
      claimStatus.dataset["state"] = result.ok ? "ok" : "error";
      if (result.ok) {
        claimInput.value = "";
        void refresh();
      }
    });
  });

  nameToggle.addEventListener("change", () => {
    const show = nameToggle.checked;
    nameToggle.disabled = true;
    void window.adcode.referrals.setShowName(show).then((next) => {
      nameToggle.disabled = false;
      if (next !== null) {
        view = next;
        render();
      } else {
        nameToggle.checked = !show;
      }
    });
  });

  return {
    element: card,
    shown() {
      void refresh().then(async () => {
        // The one other moment the clipboard is looked at: a new account opening this panel.
        if (view?.canClaim !== true) return;
        const found = await window.adcode.referrals.checkClipboard();
        if (found.claimed) {
          claimStatus.textContent = claimMessage({ ok: true, inviterName: found.inviterName });
          claimStatus.dataset["state"] = "ok";
          await refresh();
        }
      });
    },
    hidden() {
      claimStatus.textContent = "";
    },
    refresh,
  };
}
