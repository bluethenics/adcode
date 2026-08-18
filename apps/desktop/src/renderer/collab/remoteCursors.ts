/**
 * Other people's cursors, drawn in the editor.
 *
 * Monaco decorations rather than absolutely-positioned overlays. A decoration is anchored to a
 * *position in the model*, so it moves with the text when anything above it changes - which is
 * the whole problem with drawing a caret on top of an editor: the moment the local user presses
 * Enter on line one, an overlay computed from pixel coordinates is wrong and stays wrong until
 * the next presence message arrives.
 *
 * The name label is a CSS `::after` on the caret decoration, with the colour and the text passed
 * through custom properties. That is deliberate rather than clever: Monaco owns the DOM inside
 * the editor and re-renders lines as they scroll, so any element this file appended would be
 * destroyed on the next render pass. A decoration's class survives because Monaco reapplies it.
 *
 * A participant's colour is decided by join order in `@adcode/collab`, so nothing here has to
 * negotiate or remember one - the same person is the same colour on every machine in the session.
 */
import * as monaco from "monaco-editor";
import { labelInkFor, selectionTintFor } from "@adcode/collab";
import type { CollabParticipantView, CollabPresenceView } from "../../shared/api.ts";

export interface RemoteCursors {
  /**
   * Redraw for the file currently on screen.
   *
   * `path` is the active editor's workspace-relative path, or `null` when nothing is open. Only
   * presence for *this* file is drawn - a cursor from someone editing another file has no
   * position here, and guessing one would put a stranger's caret on unrelated text.
   */
  render(
    path: string | null,
    presence: readonly CollabPresenceView[],
    participants: readonly CollabParticipantView[],
    selfId: string | null,
  ): void;
  clear(): void;
  dispose(): void;
}

/**
 * One `<style>` element, rewritten as the roster changes.
 *
 * A rule per participant, because a decoration cannot carry an inline style - it carries a class
 * name. Rewritten wholesale rather than patched: the roster is at most a few dozen people and a
 * stale rule for someone who left would leave a coloured caret behind with nobody attached.
 */
function ensureStyleElement(): HTMLStyleElement {
  const existing = document.getElementById("collab-cursor-styles");
  if (existing instanceof HTMLStyleElement) return existing;

  const style = document.createElement("style");
  style.id = "collab-cursor-styles";
  document.head.append(style);
  return style;
}

/** A class-safe token from a participant id, which is opaque and not guaranteed CSS-safe. */
function classFor(participantId: string): string {
  return `collab-peer-${participantId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/**
 * Escape a name for use inside a CSS string literal.
 *
 * The name came from another machine. `session.sanitiseName` has already stripped control
 * characters and bidi overrides, but a quote or a backslash here would end the string literal
 * early and let the rest of the name become CSS declarations.
 */
function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function createRemoteCursors(editor: monaco.editor.ICodeEditor): RemoteCursors {
  let collection = editor.createDecorationsCollection([]);
  const style = ensureStyleElement();
  let lastRosterKey = "";

  function writeStyles(participants: readonly CollabParticipantView[]): void {
    // Keyed so the stylesheet is only rewritten when the roster actually changed - this is
    // called on every presence message, which is every keystroke of every peer.
    const key = participants.map((p) => `${p.id}:${p.colour}:${p.name}`).join("|");
    if (key === lastRosterKey) return;
    lastRosterKey = key;

    const rules: string[] = [];

    for (const participant of participants) {
      const name = classFor(participant.id);

      rules.push(`
.${name}-caret {
  border-left: 2px solid ${participant.colour};
  margin-left: -1px;
  position: relative;
  z-index: 5;
}
.${name}-caret::after {
  content: "${cssString(participant.name)}";
  position: absolute;
  top: -1.15em;
  left: -1px;
  padding: 0 4px;
  border-radius: 4px 4px 4px 0;
  background: ${participant.colour};
  color: ${labelInkFor(participant.colour)};
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  /* Above the text, below any Monaco widget the local user is interacting with. */
  z-index: 6;
}
.${name}-selection {
  background: ${selectionTintFor(participant.colour, 0x33)};
}`);
    }

    style.textContent = rules.join("\n");
  }

  return {
    render(path, presence, participants, selfId) {
      writeStyles(participants);

      const byId = new Map(participants.map((p) => [p.id, p]));
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];

      for (const entry of presence) {
        // Never draw our own caret: Monaco already draws it, and a decoration on top of it
        // reads as a rendering bug.
        if (entry.participantId === selfId) continue;
        // Nor anyone looking at a different file.
        if (path === null || entry.path !== path) continue;
        if (!byId.has(entry.participantId)) continue;

        const name = classFor(entry.participantId);

        decorations.push({
          range: new monaco.Range(
            entry.cursor.line,
            entry.cursor.column,
            entry.cursor.line,
            entry.cursor.column,
          ),
          options: {
            className: `${name}-caret`,
            // Survives the text around it being edited, which is the entire reason this is a
            // decoration and not an overlay.
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        });

        if (entry.selection !== null) {
          const { start, end } = entry.selection;
          const empty =
            start.line === end.line && start.column === end.column;

          if (!empty) {
            decorations.push({
              range: new monaco.Range(start.line, start.column, end.line, end.column),
              options: { className: `${name}-selection` },
            });
          }
        }
      }

      collection.set(decorations);
    },

    clear() {
      collection.set([]);
    },

    dispose() {
      collection.clear();
      collection = editor.createDecorationsCollection([]);
      style.textContent = "";
      lastRosterKey = "";
    },
  };
}
