# Assistant tools and skills

Open **ADCode Assistant → Tools & skills**. These controls apply to the built-in chat assistant. Terminal agents and Team lanes keep their own tools and permissions.

## MCP servers

1. Choose **Add MCP server**. Supply a display name, a unique lowercase server ID, and either a local executable with a JSON array of arguments or a Streamable HTTP URL.
2. Save, then **Connect**. Local connections start the specified executable after a native confirmation; HTTP connections support HTTPS and local loopback HTTP. Saving never starts a server.
3. Expand the tool list and enable the tools the assistant may discover. New tools start disabled. Use the filter to find tools by name or description.
4. Ask the assistant to use the connected service. It discovers relevant schemas on demand. Before each external call, a native dialog displays the destination tool and exact arguments. Rejecting the call prevents execution.

Status, connection errors, call counts, last duration, and tool failures appear on each server card. Reconnect to refresh the server catalogue. Changing a tool definition invalidates its saved enablement. A tool-list change notification disconnects the server so stale definitions cannot remain authorized. Removing, disabling, or disconnecting a tool prevents subsequent calls, including a call awaiting approval. An operation already accepted by an external server may still complete after cancellation.

Server definitions and tool choices persist in `assistant-controls.json` in Electron's user-data directory. Connections are deliberately disconnected on restart; reconnect from the panel. Editing a server clears its previous tool permissions. Servers run outside Adcode's file-edit sandbox: external changes do not receive Adcode checkpoints or rollback.

This implementation supports stdio and Streamable HTTP tools with text/structured results. It does not yet provide OAuth login, custom authentication headers, legacy SSE, MCP prompts/resources browsing, or inline rendering of MCP image/audio results. Keep credentials out of saved executable arguments and URLs. Use a server's own secure configuration for local credentials.

## Workspace skills

Select **Skills → Create skill** and enter a lowercase hyphenated name, a description of when to use it, and its instructions. Adcode writes `.adcode/skills/<name>/SKILL.md`, without overwriting an existing file. Preview the instructions, then enable the skill.

Refresh also discovers existing project skills one directory deep under `.agents/skills`, `.adcode/skills`, and `.claude/skills`. It detects installed user skills in `~/.agents/skills`, `~/.adcode/skills`, `~/.claude/skills`, and `~/.codex/skills`, including Codex's `.system` directory. `CODEX_HOME` is respected when set. System skills are available even without an open project. A location filter and source badges distinguish identically named installations. Adcode scans these known directories, not the whole disk or downloaded plugin caches; linked folders escaping a root are excluded.

Files need `name` and `description` YAML frontmatter, a name matching their folder, and a size below 64 KB. The parser supports plain, quoted, and block scalar metadata; it is not a full YAML parser. Invalid skills show an explanation. Project paths resolving outside the workspace are refused.

Project skill activation is tied to the project and the file contents; system activation carries across projects. Both start disabled. A changed file becomes unavailable until it is enabled again. The assistant searches enabled skill descriptions and loads full instructions only when useful. Supporting text files can be read with `load_skill`'s relative `resource` path, confined to the enabled skill's folder and limited to 64 KB. Scripts are never executed by this tool, and skills cannot grant tool permissions. Disabling a skill prevents future loads; instructions already read remain in the current conversation history. Start a fresh conversation to remove previously loaded context.

## Reliability changes

- Only three capability-management schemas enter the model request, independent of the number of connected MCP tools. Discovery returns at most eight matching capabilities and limits schema payloads.
- External calls have a 30-second timeout and receive the assistant cancellation signal. Results are capped at 24,000 characters with a visible truncation notice.
- Three identical failed tool calls stop the turn with an actionable error. A successful call resets that failure count.
- Response-token and 24-step cutoffs report incomplete work, so the desktop does not treat a cutoff as a successful turn eligible for trusted automatic apply.
- The activity trace labels capability discovery, skill loading, and MCP calls, including the server/tool being used.

## Research behind the changes

Research reviewed on 2026-09-21:

| Observed problem | Evidence | Implemented response |
| --- | --- | --- |
| Tools can be connected but invisible to the assistant/user | [VS Code issue #246461](https://github.com/microsoft/vscode/issues/246461) | Explicit connection status, discovered tool counts, switches backed by main-process state, and visible errors |
| Large tool catalogues consume context and complicate selection | [Anthropic: advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) | Search capabilities first; load only matching schemas instead of sending every connected tool definition |
| External tools need transparent invocation and user control | [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | Exact-argument confirmation, cancellation, timeouts, execution-time permission checks, and trace entries |
| Reusable instructions should load progressively | [Agent Skills specification](https://agentskills.io/specification) | Workspace skill discovery, metadata-only search, preview/activation, and on-demand instruction loading |

These are concrete usability and reliability improvements, not evidence that Adcode outperforms every competing assistant. Model quality and task success still require comparative evaluations.
