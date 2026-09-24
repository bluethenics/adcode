/** Host facts are separate from project content and remain current across turns. */
export function aiWorkspaceContext(root: string | null, blocker: string | null): string {
  if (root === null) return "Workspace status: no folder is open. Ask the user to open or create a project folder in ADCode before creating files. Pasting a path does not open a workspace.";
  return [
    `Open workspace root (JSON string): ${JSON.stringify(root)}.`,
    "The workspace is already selected. Do not ask the user for its path. Use list_files with no path (or an empty string) to inspect its root; use relative paths with read_file and propose_edit. propose_edit can create new files.",
    "To list images or files by shape, use glob_files (e.g. **/*.png). Skim long files with get_outline, page reads with offset/limit, run tests with run_command, and fetch docs with fetch_url.",
    blocker === null ? "File tools are available in the isolated task workspace. Proposals require review before they reach the user's project." : `File tools are temporarily unavailable: ${blocker}`,
    "For a web app, use open_preview to show the actual local live server in the conversation. It previews saved/applied project files; unapplied proposals are not visible. Do not claim a desktop Python GUI can run inside a web preview.",
  ].join("\n");
}
