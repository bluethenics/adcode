/**
 * The chat, trace, and inline-diff widgets.
 *
 * Brief §5.3: "The AI surface is **floating widgets**, not a docked side panel. Panels
 * force a layout decision on every session; widgets appear where the work is and get out
 * of the way."
 *
 * - Chat: floating, draggable, resizable, summoned by shortcut, remembers its position
 *   per workspace, "dismisses on Escape without losing the conversation."
 * - Trace: "shows the agent's *workings*, live... Collapsed to one line by default,
 *   expandable to full detail. This is what makes the AI legible instead of magical, and
 *   it is what a developer will judge the feature on."
 * - Inline diff: accepted or rejected per hunk. Nothing is written to disk unseen.
 *
 * Only `transform` and `opacity` animate (§1) - the card is positioned with a translate,
 * never with `left`/`top`, so dragging never triggers layout.
 */
import type { ProposedEditView } from "../../shared/api.ts";

interface Position {
  x: number;
  y: number;
}

/** §5.3: "Remembers position per workspace." */
function positionKey(workspace: string | null): string {
  return `adcode.chat.position.${workspace ?? "no-workspace"}`;
}

function loadPosition(workspace: string | null): Position | null {
  try {
    const raw = localStorage.getItem(positionKey(workspace));
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { x, y } = parsed as Position;
    return typeof x === "number" && typeof y === "number" ? { x, y } : null;
  } catch {
    return null;
  }
}

function savePosition(workspace: string | null, position: Position): void {
  try {
    localStorage.setItem(positionKey(workspace), JSON.stringify(position));
  } catch {
    // A full or disabled storage costs a remembered position, nothing more.
  }
}

export interface ChatWidget {
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  setWorkspace(root: string | null): void;
}

export interface ChatWidgetDeps {
  readonly host: HTMLElement;
  readonly openExternalPath: (path: string) => void;
}

export function createChatWidget(deps: ChatWidgetDeps): ChatWidget {
  let workspace: string | null = null;
  let open = false;
  let position: Position = { x: 0, y: 0 };
  let streamingBubble: HTMLElement | null = null;

  const card = document.createElement("section");
  card.className = "chat-card";
  card.hidden = true;
  card.setAttribute("role", "complementary");
  card.setAttribute("aria-label", "Assistant");

  /* ── Header (drag handle) ─────────────────────────────────────────────── */

  const header = document.createElement("header");
  header.className = "chat-header";

  const title = document.createElement("span");
  title.className = "chat-title";
  title.textContent = "Assistant";

  const modelLabel = document.createElement("span");
  modelLabel.className = "chat-model";

  const resetButton = document.createElement("button");
  resetButton.className = "ghost-button";
  resetButton.textContent = "New";
  resetButton.title = "Start a new conversation";
  resetButton.addEventListener("click", () => {
    window.adcode.ai.reset();
    transcript.replaceChildren();
    streamingBubble = null;
  });

  const closeButton = document.createElement("button");
  closeButton.className = "ghost-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => api.close());

  header.append(title, modelLabel, resetButton, closeButton);

  /* ── Transcript ───────────────────────────────────────────────────────── */

  const transcript = document.createElement("div");
  transcript.className = "chat-transcript";
  transcript.setAttribute("aria-live", "polite");

  /* ── Composer ─────────────────────────────────────────────────────────── */

  const composer = document.createElement("form");
  composer.className = "chat-composer";

  const input = document.createElement("textarea");
  input.className = "chat-input";
  input.rows = 2;
  input.placeholder = "Ask about this project…";
  input.setAttribute("aria-label", "Message the assistant");

  const sendButton = document.createElement("button");
  sendButton.className = "chat-send";
  sendButton.type = "submit";
  sendButton.textContent = "Send";

  composer.append(input, sendButton);

  const resizeGrip = document.createElement("div");
  resizeGrip.className = "chat-resize";
  resizeGrip.setAttribute("aria-hidden", "true");

  card.append(header, transcript, composer, resizeGrip);
  deps.host.append(card);

  /* ── Rendering ────────────────────────────────────────────────────────── */

  function scrollToEnd(): void {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function bubble(role: "user" | "assistant", text: string): HTMLElement {
    const element = document.createElement("div");
    element.className = `chat-bubble chat-bubble-${role}`;
    element.textContent = text;
    transcript.append(element);
    scrollToEnd();
    return element;
  }

  /**
   * One trace line. §5.3: "Collapsed to one line by default, expandable to full detail."
   * A `<details>` gives that for free, with correct keyboard and screen-reader behaviour.
   */
  function trace(summary: string, detail: string, state: "running" | "ok" | "error"): HTMLElement {
    const element = document.createElement("details");
    element.className = "trace-entry";
    element.dataset["state"] = state;

    const line = document.createElement("summary");
    line.className = "trace-summary";
    line.textContent = summary;

    const body = document.createElement("pre");
    body.className = "trace-detail";
    body.textContent = detail;

    element.append(line, body);
    transcript.append(element);
    scrollToEnd();
    return element;
  }

  function inlineDiff(edit: ProposedEditView): void {
    const panel = document.createElement("div");
    panel.className = "diff-panel";

    const heading = document.createElement("div");
    heading.className = "diff-heading";
    heading.textContent = `${edit.summary} — ${edit.displayPath}`;

    const accepted = new Set(edit.hunks.map((hunk) => hunk.id));
    panel.append(heading);

    for (const hunk of edit.hunks) {
      const block = document.createElement("div");
      block.className = "diff-hunk";

      const toggle = document.createElement("label");
      toggle.className = "diff-toggle";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) accepted.add(hunk.id);
        else accepted.delete(hunk.id);
        block.dataset["accepted"] = String(checkbox.checked);
      });

      const label = document.createElement("span");
      label.textContent = `Line ${hunk.startLine + 1}`;
      toggle.append(checkbox, label);

      const body = document.createElement("pre");
      body.className = "diff-body";

      for (const line of hunk.original) {
        const removed = document.createElement("span");
        removed.className = "diff-line diff-removed";
        removed.textContent = `- ${line}`;
        body.append(removed);
      }
      for (const line of hunk.replacement) {
        const added = document.createElement("span");
        added.className = "diff-line diff-added";
        added.textContent = `+ ${line}`;
        body.append(added);
      }

      block.dataset["accepted"] = "true";
      block.append(toggle, body);
      panel.append(block);
    }

    const actions = document.createElement("div");
    actions.className = "diff-actions";

    const apply = document.createElement("button");
    apply.className = "chat-send";
    apply.textContent = "Apply selected";
    apply.addEventListener("click", () => {
      void window.adcode.ai.applyHunks(edit.path, [...accepted]).then((okay) => {
        heading.textContent = okay
          ? `Applied ${accepted.size} of ${edit.hunks.length} to ${edit.displayPath}`
          : `Could not write ${edit.displayPath}`;
        actions.remove();
        deps.openExternalPath(edit.path);
      });
    });

    const reject = document.createElement("button");
    reject.className = "ghost-button";
    reject.textContent = "Reject all";
    reject.addEventListener("click", () => {
      // Applying nothing is how a rejection is recorded: the proposal is discarded and
      // the file is left byte-identical.
      void window.adcode.ai.applyHunks(edit.path, []).then(() => {
        heading.textContent = `Rejected — ${edit.displayPath} is unchanged`;
        actions.remove();
      });
    });

    actions.append(apply, reject);
    panel.append(actions);
    transcript.append(panel);
    scrollToEnd();
  }

  /* ── Events from the agent ────────────────────────────────────────────── */

  window.adcode.ai.onEvent((raw) => {
    const event = raw as { kind: string; [key: string]: unknown };

    switch (event.kind) {
      case "text": {
        // Append to the live bubble rather than creating one per delta.
        streamingBubble ??= bubble("assistant", "");
        streamingBubble.textContent = `${streamingBubble.textContent ?? ""}${String(event["text"])}`;
        scrollToEnd();
        break;
      }

      case "thinking":
        trace("Thinking", String(event["text"]), "running");
        break;

      case "tool-call": {
        const call = event["call"] as { name: string; input: unknown };
        streamingBubble = null;
        trace(`Using ${call.name}`, JSON.stringify(call.input, null, 2), "running");
        break;
      }

      case "tool-result": {
        const isError = event["isError"] === true;
        trace(
          `${isError ? "Failed" : "Result"}: ${String(event["name"])}`,
          String(event["content"]).slice(0, 4000),
          isError ? "error" : "ok",
        );
        break;
      }

      case "refusal":
        streamingBubble = null;
        bubble("assistant", `The model declined this request. ${String(event["detail"] ?? "")}`.trim());
        break;

      case "error":
        streamingBubble = null;
        trace("Error", String(event["detail"] ?? "unknown"), "error");
        break;

      case "cancelled":
        streamingBubble = null;
        trace("Cancelled", "You stopped this turn.", "ok");
        break;

      case "turn-end":
        streamingBubble = null;
        sendButton.disabled = false;
        break;
    }
  });

  window.adcode.ai.onProposedEdit((edit) => {
    streamingBubble = null;
    inlineDiff(edit);
  });

  /* ── Sending ──────────────────────────────────────────────────────────── */

  function submit(): void {
    const text = input.value.trim();
    if (text.length === 0) return;

    bubble("user", text);
    input.value = "";
    sendButton.disabled = true;
    streamingBubble = null;

    void window.adcode.ai.send(text).catch(() => {
      sendButton.disabled = false;
    });
  }

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener("keydown", (event) => {
    // Enter sends, Shift+Enter is a newline - the convention every chat surface uses.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  /* ── Dragging and resizing ────────────────────────────────────────────── */

  function place(next: Position): void {
    position = next;
    // A translate, never `left`/`top`: §1 allows only transform and opacity to animate,
    // and dragging with layout properties janks the editor behind it.
    card.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }

  header.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).tagName === "BUTTON") return;

    const startX = event.clientX - position.x;
    const startY = event.clientY - position.y;
    header.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      place({ x: moveEvent.clientX - startX, y: moveEvent.clientY - startY });
    };

    const release = (): void => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", release);
      savePosition(workspace, position);
    };

    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", release);
  });

  resizeGrip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startWidth = card.offsetWidth;
    const startHeight = card.offsetHeight;
    const startX = event.clientX;
    const startY = event.clientY;
    resizeGrip.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      card.style.width = `${Math.max(320, startWidth + (moveEvent.clientX - startX))}px`;
      card.style.height = `${Math.max(260, startHeight + (moveEvent.clientY - startY))}px`;
    };

    const release = (): void => {
      resizeGrip.removeEventListener("pointermove", move);
      resizeGrip.removeEventListener("pointerup", release);
    };

    resizeGrip.addEventListener("pointermove", move);
    resizeGrip.addEventListener("pointerup", release);
  });

  /* ── Open / close ─────────────────────────────────────────────────────── */

  const onKeydown = (event: KeyboardEvent): void => {
    // §5.3: "Dismisses on Escape without losing the conversation." The transcript and the
    // agent's history both survive - only the card is hidden.
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
    }
  };

  const api: ChatWidget = {
    open(): void {
      if (open) return;
      open = true;

      card.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.dataset["state"] = "open";
          input.focus();
        });
      });

      void window.adcode.ai.status().then((status) => {
        modelLabel.textContent = status.ready
          ? status.activeModel
          : "No API key — add one in Settings";
      });

      document.addEventListener("keydown", onKeydown);
    },

    close(): void {
      if (!open) return;
      open = false;

      delete card.dataset["state"];
      document.removeEventListener("keydown", onKeydown);
      window.setTimeout(() => {
        if (!open) card.hidden = true;
      }, 200);
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open,

    setWorkspace(root: string | null): void {
      workspace = root;
      place(loadPosition(root) ?? { x: 0, y: 0 });
    },
  };

  place({ x: 0, y: 0 });
  return api;
}
