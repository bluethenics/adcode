import type { AiCheckpointView, AiUndoResultView } from "../../shared/api.ts";
import { createIcon, ICON } from "../workbench/icons.ts";

/** One turn's real file changes, with a lazy diff and the existing conflict-aware Undo. */
export function createEditSummary(checkpoint: AiCheckpointView, deps: {
  readonly openFile: (path: string) => void;
  readonly undo: (id: string, force: boolean) => Promise<AiUndoResultView>;
}): HTMLElement {
  const card = document.createElement("section");
  card.className = "chat-checkpoint";
  card.dataset["checkpointId"] = checkpoint.id;
  const header = document.createElement("div"); header.className = "chat-checkpoint-header";
  const icon = document.createElement("span"); icon.className = "chat-checkpoint-icon";
  icon.setAttribute("aria-hidden", "true"); icon.append(createIcon(ICON.edit));
  const body = document.createElement("div"); body.className = "chat-checkpoint-body";
  const title = document.createElement("strong"); title.className = "chat-checkpoint-title";
  const count = checkpoint.files.length;
  title.textContent = `Edited ${count} file${count === 1 ? "" : "s"}`;
  if (checkpoint.undone === true) {
    card.dataset["state"] = "undone";
    title.textContent = `Undid edits to ${count} file${count === 1 ? "" : "s"}`;
  }
  const totals = document.createElement("span"); totals.className = "chat-checkpoint-counts";
  function counts(added: number, removed: number): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const plus = document.createElement("span"); plus.className = "chat-edit-added"; plus.textContent = `+${added}`;
    const minus = document.createElement("span"); minus.className = "chat-edit-removed"; minus.textContent = `−${removed}`;
    fragment.append(plus, minus); return fragment;
  }
  const counted = checkpoint.files.filter(file => file.added !== undefined && file.removed !== undefined && file.lineEndingsOnly !== true);
  if (counted.length > 0) totals.append(counts(counted.reduce((sum, f) => sum + f.added!, 0), counted.reduce((sum, f) => sum + f.removed!, 0)));
  else if (count > 0 && checkpoint.files.every(file => file.lineEndingsOnly === true)) totals.textContent = "Line endings only";
  body.append(title, totals);
  const actions = document.createElement("div"); actions.className = "chat-checkpoint-actions";
  const undo = document.createElement("button"); undo.type = "button"; undo.className = "chat-checkpoint-undo";
  undo.textContent = "Undo"; undo.title = "Restore these files to before this turn";
  undo.hidden = checkpoint.undone === true;
  const review = document.createElement("button"); review.type = "button"; review.className = "chat-checkpoint-review";
  review.textContent = "Review"; review.setAttribute("aria-expanded", "false");
  actions.append(undo, review); header.append(icon, body, actions);
  const list = document.createElement("div"); list.className = "chat-checkpoint-files";
  const rows = checkpoint.files.map(file => {
    const row = document.createElement("div"); row.className = "chat-checkpoint-row";
    const open = document.createElement("button"); open.type = "button"; open.className = "chat-checkpoint-file";
    open.textContent = file.path; open.title = `${file.deleted ? "Deleted" : file.created ? "Created" : "Edited"} ${file.path}`;
    if (file.deleted) { open.disabled = true; open.dataset["deleted"] = "true"; }
    else open.addEventListener("click", () => deps.openFile(file.path));
    const tally = document.createElement("span"); tally.className = "chat-checkpoint-counts";
    if (file.lineEndingsOnly === true) tally.textContent = "Line endings only";
    else if (file.added !== undefined && file.removed !== undefined) tally.append(counts(file.added, file.removed));
    else tally.textContent = "File changed";
    row.append(open, tally); list.append(row); return row;
  });
  const more = document.createElement("button"); more.type = "button"; more.className = "chat-checkpoint-more";
  let expanded = false;
  function paintRows(): void {
    rows.forEach((row, index) => { row.hidden = !expanded && index >= 3; });
    more.textContent = expanded ? "Show fewer files" : `Show ${count - 3} more file${count - 3 === 1 ? "" : "s"}`;
    more.setAttribute("aria-expanded", String(expanded)); more.hidden = count <= 3;
  }
  more.addEventListener("click", () => { expanded = !expanded; paintRows(); }); paintRows();
  const diffs = document.createElement("div"); diffs.className = "chat-checkpoint-diffs"; diffs.hidden = true;
  let rendered = false;
  review.addEventListener("click", () => {
    if (!rendered) {
      for (const file of checkpoint.files) {
        const heading = document.createElement("h4"); heading.textContent = file.path; diffs.append(heading);
        if (file.hunks === undefined) {
          const note = document.createElement("p"); note.textContent = "Line review is unavailable for this file. Open it to inspect the current version."; diffs.append(note); continue;
        }
        if (file.lineEndingsOnly === true) {
          const note = document.createElement("p"); note.textContent = "Only the line endings changed (Windows CRLF and Unix LF). Every line reads the same."; diffs.append(note); continue;
        }
        const pre = document.createElement("pre"); pre.className = "diff-body";
        let shown = 0;
        for (const hunk of file.hunks) {
          const location = document.createElement("span"); location.className = "chat-checkpoint-diff-location"; location.textContent = `Line ${hunk.startLine + 1}`; pre.append(location);
          for (const [lines, sign, style] of [[hunk.original, "−", "diff-removed"], [hunk.replacement, "+", "diff-added"]] as const) {
            for (const line of lines) {
              if (shown++ >= 2000) break;
              const node = document.createElement("span"); node.className = `diff-line ${style}`; node.textContent = `${sign} ${line}`; pre.append(node);
            }
          }
          if (shown >= 2000) break;
        }
        diffs.append(pre);
        if (shown >= 2000) { const note = document.createElement("p"); note.textContent = "Showing the first 2,000 changed lines. Open the file to inspect the rest."; diffs.append(note); }
      }
      rendered = true;
    }
    diffs.hidden = !diffs.hidden; review.setAttribute("aria-expanded", String(!diffs.hidden));
    review.textContent = diffs.hidden ? "Review" : "Hide review";
  });
  const status = document.createElement("p"); status.className = "chat-checkpoint-status"; status.setAttribute("role", "status"); status.hidden = true;
  let force = false;
  undo.addEventListener("click", () => {
    undo.disabled = true;
    void deps.undo(checkpoint.id, force).then(result => {
      status.hidden = false; status.textContent = result.message;
      if (result.ok) {
        card.dataset["state"] = "undone"; undo.hidden = true;
        title.textContent = `Undid edits to ${count} file${count === 1 ? "" : "s"}`;
      } else {
        if (result.conflicts.length > 0) { force = true; undo.textContent = "Undo anyway"; undo.title = `Overwrite your later edits to ${result.conflicts.join(", ")}`; }
        undo.disabled = false;
      }
    }, () => { status.hidden = false; status.textContent = "Could not undo this turn. Try again."; undo.disabled = false; });
  });
  card.append(header, list, more, diffs, status);
  return card;
}
