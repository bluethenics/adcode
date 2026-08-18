/**
 * The session panel: start sharing, join, and see who is here.
 *
 * A popover on the status bar rather than a sidebar view, for the same reason the earnings
 * report is one: it is consulted in passing - "who is in here, can they edit" - and taking the
 * explorer's place to answer that would make the user navigate back.
 *
 * **This panel says two uncomfortable things out loud, and both are load-bearing.**
 *
 * Starting a session binds a port on the local network, which is the exact opposite of what
 * `liveServer.ts` does and documents at length. The user is told the address that was published,
 * because "sharing" is far too vague a word for "any device on this network can now reach a
 * server on your machine". And LAN traffic is unencrypted, so the panel says that too rather
 * than letting a padlock-free UI imply safety by omission. A user on a café network deserves to
 * know before they paste the code, not afterwards.
 *
 * Granting the writable terminal is the one control here with a real warning attached, because
 * it is the one that stops being about text: it hands someone a shell on this machine.
 */
import { abbreviateInvite } from "@adcode/collab";
import { ICON, iconButton } from "../workbench/icons.ts";
import type {
  CollabParticipantView,
  CollabRole,
  CollabStatusView,
} from "../../shared/api.ts";

export interface CollabPanelDeps {
  readonly host: HTMLElement;
  /** The status-bar button this hangs off. Drives placement and `aria-expanded`. */
  readonly anchor: HTMLElement;
  readonly notify: (message: string) => void;
  /** Asks the user to confirm something consequential. Resolves false on cancel. */
  readonly confirm: (title: string, detail: string, confirmLabel: string) => Promise<boolean>;
  /** Asks for a line of text. `null` on cancel. */
  readonly prompt: (title: string, detail: string, initial: string) => Promise<string | null>;
}

export interface CollabPanel {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  update(status: CollabStatusView): void;
}

const ROLE_LABEL: Readonly<Record<CollabRole, string>> = {
  host: "Host",
  editor: "Can edit",
  viewer: "View only",
};

/** The display name offered to peers. Remembered, because typing it every session is friction. */
const NAME_KEY = "adcode.collab.displayName";

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A remembered name is a convenience; losing it costs one prompt.
  }
}

function section(title: string): { element: HTMLElement; body: HTMLElement } {
  const element = document.createElement("div");
  element.className = "collab-section";

  const heading = document.createElement("h3");
  heading.className = "collab-heading";
  heading.textContent = title;

  const body = document.createElement("div");
  body.className = "collab-section-body";

  element.append(heading, body);
  return { element, body };
}

export function createCollabPanel(deps: CollabPanelDeps): CollabPanel {
  const card = document.createElement("section");
  card.className = "collab-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Live session");
  card.hidden = true;

  /* ── Header ─────────────────────────────────────────────────────────────── */

  const header = document.createElement("header");
  header.className = "collab-header";

  const title = document.createElement("h2");
  title.className = "collab-title";
  title.textContent = "Live session";

  const closeButton = iconButton("Close", ICON.close, "collab-close");
  closeButton.addEventListener("click", () => api.close());

  header.append(title, closeButton);

  /* ── The off state: start or join ───────────────────────────────────────── */

  const offState = document.createElement("div");
  offState.className = "collab-off";

  const blurb = document.createElement("p");
  blurb.className = "collab-blurb";
  blurb.textContent =
    "Share this folder with people on your network. They edit the files on this machine — nothing is copied to theirs.";

  const shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.className = "collab-primary";
  shareButton.textContent = "Share this folder";

  const joinButton = document.createElement("button");
  joinButton.type = "button";
  joinButton.className = "ghost-button";
  joinButton.textContent = "Join with a code";

  const offActions = document.createElement("div");
  offActions.className = "collab-actions";
  offActions.append(shareButton, joinButton);

  offState.append(blurb, offActions);

  /* ── The on state: the invite and the roster ────────────────────────────── */

  const onState = document.createElement("div");
  onState.className = "collab-on";
  onState.hidden = true;

  const inviteSection = section("Invite code");
  const inviteRow = document.createElement("div");
  inviteRow.className = "collab-invite-row";

  const inviteText = document.createElement("code");
  inviteText.className = "collab-invite";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "ghost-button";
  copyButton.textContent = "Copy";

  inviteRow.append(inviteText, copyButton);

  /**
   * Which address to publish.
   *
   * A laptop has several, and only the user knows which network their guest is on. Guessing and
   * hiding the choice means handing out a code that cannot work, with no way to tell why.
   */
  const addressPicker = document.createElement("select");
  addressPicker.className = "collab-address";
  addressPicker.setAttribute("aria-label", "Address to share");

  const exposure = document.createElement("p");
  exposure.className = "collab-warning";

  inviteSection.body.append(inviteRow, addressPicker, exposure);

  const rosterSection = section("People");
  const roster = document.createElement("ul");
  roster.className = "collab-roster";
  rosterSection.body.append(roster);

  const leaveButton = document.createElement("button");
  leaveButton.type = "button";
  leaveButton.className = "collab-leave";
  leaveButton.textContent = "End session";

  onState.append(inviteSection.element, rosterSection.element, leaveButton);

  /* ── Errors ─────────────────────────────────────────────────────────────── */

  const errorLine = document.createElement("p");
  errorLine.className = "collab-error";
  errorLine.hidden = true;

  card.append(header, errorLine, offState, onState);
  deps.host.append(card);

  let open = false;
  let latest: CollabStatusView | null = null;

  /* ── Actions ────────────────────────────────────────────────────────────── */

  async function askName(): Promise<string | null> {
    const existing = storedName();
    const name = await deps.prompt(
      "Your name",
      "This is what the other people in the session will see next to your cursor.",
      existing,
    );

    if (name === null) return null;

    const trimmed = name.trim();
    if (trimmed.length === 0) return null;

    rememberName(trimmed);
    return trimmed;
  }

  shareButton.addEventListener("click", () => {
    void (async () => {
      const name = await askName();
      if (name === null) return;

      /*
       * The confirmation before publishing to the network.
       *
       * Not ceremony. Every other server this app starts is bound to loopback on purpose, and
       * this is the one that is not - so the user is told, in plain words, what is about to be
       * reachable and by whom, before it happens rather than after.
       */
      const agreed = await deps.confirm(
        "Share this folder on your network?",
        "Anyone on your Wi-Fi or local network who has the invite code will be able to open and edit the files in this folder, on this machine. The connection is not encrypted, so avoid this on public or shared networks.",
        "Share",
      );
      if (!agreed) return;

      const status = await window.adcode.collab.host({
        bind: "lan",
        port: 0,
        displayName: name,
      });

      if (status.error !== null) deps.notify(status.error);
    })();
  });

  joinButton.addEventListener("click", () => {
    void (async () => {
      const code = await deps.prompt(
        "Join a session",
        "Paste the invite code the host sent you.",
        "",
      );
      if (code === null || code.trim().length === 0) return;

      const name = await askName();
      if (name === null) return;

      const status = await window.adcode.collab.join(code.trim(), name);
      if (status.error !== null) deps.notify(status.error);
    })();
  });

  copyButton.addEventListener("click", () => {
    const code = latest?.invite;
    if (code === undefined || code === null) return;

    void window.adcode.clipboard.writeText(code);
    deps.notify("Invite code copied. Send it to whoever is joining.");
  });

  addressPicker.addEventListener("change", () => {
    void (async () => {
      const reissued = await window.adcode.collab.reencodeInvite(addressPicker.value);
      if (reissued === null) {
        deps.notify("That address cannot be used for a session.");
        return;
      }

      inviteText.textContent = abbreviateInvite(reissued);
      inviteText.title = reissued;
      // The stored status still holds the old code, and Copy reads from it.
      if (latest !== null) latest = { ...latest, invite: reissued };
    })();
  });

  leaveButton.addEventListener("click", () => {
    void window.adcode.collab.leave();
  });

  /* ── Rendering ──────────────────────────────────────────────────────────── */

  function roleControl(participant: CollabParticipantView): HTMLElement {
    const select = document.createElement("select");
    select.className = "collab-role";
    select.setAttribute("aria-label", `What ${participant.name} can do`);

    for (const role of ["editor", "viewer"] as const) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = ROLE_LABEL[role];
      option.selected = participant.role === role;
      select.append(option);
    }

    select.addEventListener("change", () => {
      void window.adcode.collab.setRole(participant.id, select.value as CollabRole);
    });

    return select;
  }

  function terminalControl(participant: CollabParticipantView): HTMLElement {
    const label = document.createElement("label");
    label.className = "collab-terminal-grant";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = participant.terminalWrite;
    box.disabled = participant.role === "viewer";

    const caption = document.createElement("span");
    caption.textContent = "Terminal";

    box.addEventListener("change", () => {
      void (async () => {
        if (box.checked) {
          /*
           * The one control in this panel that stops being about text.
           *
           * A writable terminal is arbitrary command execution on this machine: reading any
           * file the user can read, deleting things, reaching the network. The warning is blunt
           * on purpose, and the checkbox reverts if the user declines - a control that stayed
           * ticked after a cancelled confirmation would misreport what was granted.
           */
          const agreed = await deps.confirm(
            `Give ${participant.name} terminal access?`,
            "They will be able to run any command on this computer — including reading and deleting files outside this folder. Only do this for someone you trust completely.",
            "Give access",
          );

          if (!agreed) {
            box.checked = false;
            return;
          }
        }

        await window.adcode.collab.setTerminalWrite(participant.id, box.checked);
      })();
    });

    label.append(box, caption);
    return label;
  }

  function renderRoster(status: CollabStatusView): void {
    const canAdminister = status.can?.administer === true;

    roster.replaceChildren(
      ...status.participants.map((participant) => {
        const row = document.createElement("li");
        row.className = "collab-person";

        const dot = document.createElement("span");
        dot.className = "collab-dot";
        dot.style.background = participant.colour;
        dot.setAttribute("aria-hidden", "true");

        const name = document.createElement("span");
        name.className = "collab-person-name";
        // `textContent`, never `innerHTML`: this string came from another machine.
        name.textContent = participant.name;
        if (participant.id === status.selfId) name.textContent += " (you)";

        row.append(dot, name);

        if (participant.role === "host") {
          const badge = document.createElement("span");
          badge.className = "collab-person-role";
          badge.textContent = ROLE_LABEL.host;
          row.append(badge);
        } else if (canAdminister) {
          row.append(roleControl(participant), terminalControl(participant));
        } else {
          const badge = document.createElement("span");
          badge.className = "collab-person-role";
          badge.textContent = ROLE_LABEL[participant.role];
          row.append(badge);
        }

        return row;
      }),
    );
  }

  function render(): void {
    const status = latest;

    if (status === null) {
      offState.hidden = false;
      onState.hidden = true;
      errorLine.hidden = true;
      return;
    }

    errorLine.hidden = status.error === null;
    errorLine.textContent = status.error ?? "";

    const running = status.mode === "hosting" || status.mode === "joined";
    offState.hidden = running || status.mode === "connecting";
    onState.hidden = !running;

    if (status.mode === "connecting") {
      blurb.textContent = "Connecting…";
      offState.hidden = false;
      onState.hidden = true;
      return;
    }

    blurb.textContent =
      "Share this folder with people on your network. They edit the files on this machine — nothing is copied to theirs.";

    if (!running) return;

    const hosting = status.mode === "hosting";

    // A guest has no code to pass on, so the whole section goes rather than showing an empty box.
    inviteSection.element.hidden = !hosting;
    leaveButton.textContent = hosting ? "End session" : "Leave session";

    if (hosting && status.invite !== null) {
      inviteText.textContent = abbreviateInvite(status.invite);
      inviteText.title = status.invite;

      const options = status.addresses.length > 0 ? status.addresses : ["127.0.0.1"];
      // Rebuilt only when the list changed, or selecting an address would reset on every status
      // broadcast - which arrives on every roster change.
      const key = options.join(",");
      if (addressPicker.dataset["key"] !== key) {
        addressPicker.dataset["key"] = key;
        addressPicker.replaceChildren(
          ...options.map((address) => {
            const option = document.createElement("option");
            option.value = address;
            option.textContent = address;
            return option;
          }),
        );
      }
      addressPicker.hidden = options.length < 2;

      exposure.textContent =
        status.port === null
          ? ""
          : `Reachable on your network at ${addressPicker.value || options[0]}:${status.port}. The connection is not encrypted.`;
    }

    renderRoster(status);
    if (open) place();
  }

  /* ── Placement and dismissal ────────────────────────────────────────────── */

  function place(): void {
    const anchor = deps.anchor.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const margin = 8;

    // Above the status bar and right-aligned to the button, pulled back inside the window.
    const left = Math.max(
      margin,
      Math.min(anchor.right - box.width, window.innerWidth - box.width - margin),
    );

    card.style.left = `${left}px`;
    card.style.top = `${Math.max(margin, anchor.top - box.height - margin)}px`;
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!open) return;

    const target = event.target as Node;
    if (card.contains(target) || deps.anchor.contains(target)) return;
    api.close();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
      deps.anchor.focus();
    }
  };

  const onResize = (): void => {
    if (open) place();
  };

  const api: CollabPanel = {
    open(): void {
      if (open) return;

      open = true;
      card.hidden = false;
      deps.anchor.setAttribute("aria-expanded", "true");
      // After unhiding: a hidden element measures zero, so placing first pins it to a corner.
      place();

      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeydown);
      window.addEventListener("resize", onResize);
    },

    close(): void {
      if (!open) return;

      open = false;
      card.hidden = true;
      deps.anchor.setAttribute("aria-expanded", "false");

      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open,

    update(status: CollabStatusView): void {
      latest = status;
      render();
    },
  };

  render();

  return api;
}
