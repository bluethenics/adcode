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
import type { ChatSessionView, ProposedEditView } from "../../shared/api.ts";

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
  /**
   * Open the card with a question already asked.
   *
   * The Problems panel's "Explain this" is the caller: a diagnostic it has no rewrite for
   * is exactly the case where the assistant earns its place. It sends rather than merely
   * prefilling, because the user already expressed the intent by clicking a button that
   * says what it does - and if no provider is configured, the send fails and the card's
   * own header already reads "No API key", which is the honest answer to why.
   */
  ask(question: string): void;
  setWorkspace(root: string | null): void;
  /**
   * Fires whenever the card opens or closes.
   *
   * The title bar's assistant button reflects this in `aria-pressed`, and the card can go
   * away without the button being touched - Escape dismisses it, and so does its own Close
   * - so polling the command that opened it would leave the button claiming otherwise.
   */
  onVisibilityChange(listener: (open: boolean) => void): void;
}

export interface ChatWidgetDeps {
  readonly host: HTMLElement;
  readonly openExternalPath: (path: string) => void;
  /** Open the Connect screen, which owns providers, keys and models. */
  readonly openConnect: () => void;
  /** Ask the user for a new name, or null if they changed their mind. */
  readonly askForName: (current: string) => Promise<string | null>;
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

  const historyButton = document.createElement("button");
  historyButton.className = "ghost-button";
  historyButton.textContent = "History";
  historyButton.title = "Past conversations in this project";
  historyButton.setAttribute("aria-expanded", "false");
  historyButton.addEventListener("click", () => toggleHistory());

  const connectButton = document.createElement("button");
  connectButton.className = "ghost-button";
  connectButton.textContent = "Connect";
  connectButton.title = "Choose a provider and model";
  connectButton.addEventListener("click", () => deps.openConnect());

  const resetButton = document.createElement("button");
  resetButton.className = "ghost-button";
  resetButton.textContent = "New";
  resetButton.title = "Start a new conversation - the current one is kept in History";
  resetButton.addEventListener("click", () => {
    window.adcode.ai.reset();
    transcript.replaceChildren();
    streamingBubble = null;
    renderMemory(null);
    void refreshHistory();
  });

  const closeButton = document.createElement("button");
  closeButton.className = "ghost-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => api.close());

  header.append(title, modelLabel, historyButton, connectButton, resetButton, closeButton);

  /* ── Transcript ───────────────────────────────────────────────────────── */

  const transcript = document.createElement("div");
  transcript.className = "chat-transcript";
  transcript.setAttribute("aria-live", "polite");

  /* ── Composer ─────────────────────────────────────────────────────────── */

  /* -- History ---------------------------------------------------------- */

  const history = document.createElement("aside");
  history.className = "chat-history";
  history.hidden = true;
  history.setAttribute("aria-label", "Past conversations");

  const historySearch = document.createElement("input");
  historySearch.className = "chat-history-search";
  historySearch.type = "search";
  historySearch.placeholder = "Search conversations";
  historySearch.setAttribute("aria-label", "Search conversations");
  historySearch.addEventListener("input", () => renderHistory());

  const historyList = document.createElement("div");
  historyList.className = "chat-history-list";

  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "chat-history-clear";
  clearAll.textContent = "Clear all";
  clearAll.title = "Delete every saved conversation for this project";
  clearAll.addEventListener("click", () => {
    void window.adcode.chat.clear().then((sessions) => {
      saved = sessions;
      renderHistory();
    });
  });

  history.append(historySearch, historyList, clearAll);

  let saved: readonly ChatSessionView[] = [];

  async function refreshHistory(): Promise<void> {
    saved = await window.adcode.chat.sessions();
    renderHistory();
  }

  function toggleHistory(): void {
    history.hidden = !history.hidden;
    historyButton.setAttribute("aria-expanded", String(!history.hidden));
    if (!history.hidden) void refreshHistory();
  }

  function renderHistory(): void {
    const needle = historySearch.value.trim().toLowerCase();
    historyList.replaceChildren();

    const shown = saved.filter((session) => {
      if (needle.length === 0) return true;
      if (session.title.toLowerCase().includes(needle)) return true;
      // Searching inside the conversation, because people remember a phrase from the
      // middle of one rather than whatever its first line happened to be.
      return session.messages.some((message) => message.text.toLowerCase().includes(needle));
    });

    if (shown.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chat-history-empty";
      empty.textContent =
        saved.length === 0 ? "No conversations yet." : "Nothing matches that.";
      historyList.append(empty);
      return;
    }

    for (const session of shown) {
      const row = document.createElement("div");
      row.className = "chat-history-row";

      const openIt = document.createElement("button");
      openIt.type = "button";
      openIt.className = "chat-history-open";
      openIt.textContent = session.title;
      openIt.title = "Reopen this conversation";
      openIt.addEventListener("click", () => void resume(session.id));

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "chat-history-action";
      rename.textContent = "Rename";
      rename.addEventListener("click", () => {
        void deps.askForName(session.title).then(async (name) => {
          if (name === null) return;
          saved = await window.adcode.chat.rename(session.id, name);
          renderHistory();
        });
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-history-action";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        void window.adcode.chat.remove(session.id).then((sessions) => {
          saved = sessions;
          renderHistory();
        });
      });

      row.append(openIt, rename, remove);
      historyList.append(row);
    }
  }

  /** Draw a past conversation back into the transcript. */
  async function resume(id: string): Promise<void> {
    const session = await window.adcode.chat.resume(id);
    if (session === null) return;

    transcript.replaceChildren();
    streamingBubble = null;

    for (const message of session.messages) {
      bubble(message.role === "user" ? "user" : "assistant", message.text);
    }

    renderMemory(session);
    history.hidden = true;
    historyButton.setAttribute("aria-expanded", "false");
  }

  /* -- What is being remembered ----------------------------------------- */

  /*
   * The strip exists so that clearing a conversation is a button whose effect is visible.
   * An assistant that remembers invisibly is worse than one that forgets.
   */
  const memory = document.createElement("div");
  memory.className = "chat-memory";

  function renderMemory(session: ChatSessionView | null): void {
    const turns = session?.messages.length ?? 0;

    memory.textContent =
      turns === 0
        ? "New conversation - nothing remembered yet."
        : `Carrying ${String(turns)} message${turns === 1 ? "" : "s"} from this conversation.`;
  }

  renderMemory(null);

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

  const chatBody = document.createElement("div");
  chatBody.className = "chat-body";
  chatBody.append(history, transcript);

  card.append(header, chatBody, memory, composer, resizeGrip);

  window.adcode.chat.onChanged((session) => renderMemory(session));
  void window.adcode.chat.current().then((session) => renderMemory(session));
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

  /**
   * A translation that keeps the header on screen.
   *
   * The card is anchored bottom-right and moved with a translate, so a large negative `y`
   * walks it off the top of the window - and the header is the drag handle, the model
   * picker and the close button. Once it was up there nothing could bring it back. This
   * is also what a saved position needs on the way in: the window it was saved from may
   * have been bigger than the one it is being restored into.
   *
   * The bottom and right edges are deliberately allowed to hang off. Only the header has
   * to stay reachable, and clamping all four would fight the user over a card they
   * dragged half off the edge on purpose.
   */
  function clamp(next: Position): Position {
    const box = card.getBoundingClientRect();

    /*
     * A hidden card has no box, and clamping against an empty rect is not conservative -
     * it is wrong. Every measurement below reads zero, so the "keep 48px on screen" floor
     * became `x >= 48` and each call pushed the card another 48px right. Two calls before
     * it was ever shown left it permanently 96px off the right edge.
     */
    if (box.width === 0 && box.height === 0) return next;

    // Where the card would sit with no translation at all.
    const restX = box.left - position.x;
    const restY = box.top - position.y;

    const KEEP = 48;
    const minX = -restX - box.width + KEEP;
    const maxX = window.innerWidth - restX - KEEP;
    const minY = -restY;
    const maxY = window.innerHeight - restY - KEEP;

    return {
      x: Math.min(Math.max(next.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(next.y, minY), Math.max(minY, maxY)),
    };
  }

  function place(next: Position): void {
    position = clamp(next);
    // A translate, never `left`/`top`: §1 allows only transform and opacity to animate,
    // and dragging with layout properties janks the editor behind it.
    card.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }

  /*
   * Shrinking the window can strand a card that was perfectly placed a moment ago, so the
   * clamp is re-applied rather than only being checked while dragging. Passing the current
   * position back through `place` is enough - `clamp` re-reads the window each time.
   */
  window.addEventListener("resize", () => {
    place(position);
  });

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
      /*
       * A ceiling as well as a floor. The minimums were always here; without maximums you
       * could drag the card larger than the window it lives in, and the CSS `max-width`
       * would then quietly disagree with the inline width - so the grip stopped following
       * the pointer and the card looked stuck.
       */
      const maxWidth = Math.max(320, window.innerWidth - 32);
      const maxHeight = Math.max(260, window.innerHeight - 72);

      const width = startWidth + (moveEvent.clientX - startX);
      const height = startHeight + (moveEvent.clientY - startY);

      card.style.width = `${Math.min(Math.max(320, width), maxWidth)}px`;
      card.style.height = `${Math.min(Math.max(260, height), maxHeight)}px`;

      // Growing downward or rightward can push the header off; re-clamp as it changes.
      place(position);
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

  const visibilityListeners: ((open: boolean) => void)[] = [];
  const announce = (): void => {
    for (const listener of visibilityListeners) listener(open);
  };

  const api: ChatWidget = {
    open(): void {
      if (open) return;
      open = true;
      announce();

      card.hidden = false;
      requestAnimationFrame(() => {
        /*
         * The first moment the card has a box, so the first moment its saved position can
         * honestly be checked against the window. Anything earlier measures a zero rect.
         */
        place(position);

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
      announce();

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

    ask(question: string): void {
      const text = question.trim();
      if (text.length === 0) return;

      api.open();
      input.value = text;

      // `open()` focuses the input across two animation frames. Submitting inside the same
      // tick would race that: the value lands, the frame callback fires afterwards, and
      // the user is left looking at their own question sitting unsent in the box.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => submit());
      });
    },

    setWorkspace(root: string | null): void {
      workspace = root;
      place(loadPosition(root) ?? { x: 0, y: 0 });
    },

    onVisibilityChange(listener): void {
      visibilityListeners.push(listener);
    },
  };

  place({ x: 0, y: 0 });
  return api;
}
