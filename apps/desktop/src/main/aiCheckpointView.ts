import { computeHunks } from "@adcode/ai";
import type { AiCheckpointView } from "../shared/api.ts";
import type { EditCheckpoint } from "./aiCheckpoints.ts";

/** Older checkpoints were saved immediately after the assistant message, without a chat id. */
export function checkpointsForSession(
  checkpoints: readonly EditCheckpoint[],
  sessions: readonly { readonly id: string; readonly messages: readonly { readonly role: string; readonly at: number }[] }[],
  sessionId: string,
): EditCheckpoint[] {
  return checkpoints.filter(checkpoint => {
    if (checkpoint.sessionId !== undefined) return checkpoint.sessionId === sessionId;
    // Recover only a unique nearby assistant message in this project's saved chats.
    // A missing or ambiguous record costs the card; it must not borrow another chat's edits.
    const candidates = sessions.flatMap(session => session.messages.flatMap((message, index) => {
      const delay = checkpoint.createdAt - message.at;
      const next = session.messages[index + 1];
      return message.role === "assistant" && delay >= 0 && delay <= 5_000 && (next === undefined || next.at > checkpoint.createdAt) ? [session.id] : [];
    }));
    return candidates.length === 1 && candidates[0] === sessionId;
  });
}

/** Expose the recorded change for review without sending the workspace root or binary bytes. */
export function checkpointView(checkpoint: EditCheckpoint): AiCheckpointView {
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    undone: checkpoint.undone,
    files: checkpoint.files.map(file => {
      const hunks = file.encoding === "base64" ? undefined : computeHunks(file.before ?? "", file.after ?? "");
      return {
        path: file.path, created: file.before === null, deleted: file.after === null,
        ...(hunks === undefined ? {} : {
          added: hunks.reduce((sum, hunk) => sum + hunk.replacement.length, 0),
          removed: hunks.reduce((sum, hunk) => sum + hunk.original.length, 0),
          // A recorded change with no changed line: the diff reads lines without their CR, so only
          // the line endings differ. "+0 −0" would read as a broken count.
          ...(hunks.length === 0 && file.before !== null && file.after !== null && file.before !== file.after ? { lineEndingsOnly: true } : {}),
          hunks,
        }),
      };
    }),
  };
}
