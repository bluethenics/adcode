/**
 * AI: the assistant, and the memory it shares with every other agent.
 */
import type { HelpEntry } from "../types.ts";

export const AI_ENTRIES: readonly HelpEntry[] = [
  {
    id: "ai.team",
    title: "AI Team",
    plain: "Create named agents with their own instructions and models, then let a team divide a task and bring its results back for review.",
    why: "Independent research, coding, and checking can finish faster without making one assistant carry every detail in the same context.",
    how: "Open the Assistant and its activity panel. Create agents with a name, instructions, connection, and model. Enable Run after teammates for an agent that should receive others' handoffs first. Select two to four agents, describe a task in the composer, and choose Set up selected Team. Review the plan and start it. Agent rows show tasks and status; Agent trace shows tool activity and results. Review combined changes before applying them, or cancel a running team. Requests share each connection's rate limit.",
    group: "ai",
    settingIds: ["adcode.ai.agentProfiles"],
    related: ["adcode.ai.isolatedWorkspaces", "adcode.ai.taskTokenBudget", "adcode.ai.editPolicy"],
  },
  {
    id: "ai.inlineEdit",
    title: "Edit with AI",
    plain: "Select code, press Ctrl+E and say what to change. The rewrite appears in place, highlighted green under the struck-out original, for you to accept or reject.",
    why: "Small changes should not need a conversation. Adding error handling, renaming across a function or converting a loop happens where you are looking, and nothing reaches disk until you save.",
    how: "In Code mode, select the lines to change - or put the cursor where new code should go - and press Ctrl+E, or right-click and choose ADCode: Edit with AI. Type an instruction such as \"add input validation\" and press Enter. The new code appears highlighted green with the lines it replaced shown struck through above it. Press Ctrl+Enter or Accept to keep it, Esc or Reject to put the original back, or type a follow-up to refine the result. An accepted edit is an ordinary unsaved change: Ctrl+Z undoes it, and it is saved only when you save. It uses the model chosen in Connect a model and sends only the selection and the code around it.",
    group: "ai",
    settingIds: [],
    shortcut: "Ctrl+E",
    related: ["workbench.aiContext", "adcode.ai.inlineCompletion", "ai.connect"],
  },
  {
    id: "ai.composerCommands",
    title: "Slash commands and @ files",
    plain: "Type / in the assistant's composer for ready-made commands like /review and /test, or @ to put any project file in the conversation.",
    why: "Typing is faster than hunting for a button, and each command asks the way an experienced engineer would - including checking its own work - so answers come back verified rather than guessed.",
    how: "Type / at the start of the composer to list every command; keep typing to filter, then press Enter or Tab. /review and /commit attach your uncommitted changes and ask for a review or a commit message. /fix, /test, /plan, /refactor, /explain, /optimize, /security, /docs and /build write a careful prompt that you finish in your own words. /new, /history, /model, /preview, /team and /schedule act at once. Type @ anywhere to search the project's files and add one as a chip; a file open in the editor sends its unsaved text. In an empty composer, the Up arrow brings back your earlier prompts.",
    group: "ai",
    settingIds: [],
    related: ["adcode.ai.chatWidget", "workbench.aiContext", "ai.inlineEdit"],
  },
  {
    id: "adcode.ai.provider",
    title: "Provider",
    plain: "Which company's AI you want to use. You bring your own account and key.",
    why: "Different models are better at different things, and cost different amounts. ADCode does not resell anybody's AI, so the choice - and the bill - is yours.",
    how: "Open Connect a model, pick a provider, and paste your key. ADCode checks the key works before saving it. Keys are kept in your operating system's own password store, never in a settings file. The local option needs no key at all - it talks to a model running on your own machine.",
    group: "ai",
    settingIds: ["adcode.ai.provider"],
    related: ["ai.connect", "adcode.ai.chatWidget"],
  },
  {
    id: "adcode.ai.model",
    title: "Model",
    plain: "Which particular AI, from that company, answers you.",
    why: "Bigger models are cleverer and slower; smaller ones are quick and cheap. Most people want a big one for hard questions and a small one for everything else.",
    how: "Pick from the list, which shows the models your key can actually reach rather than a fixed set. Switching takes effect on your next message - it does not restart the conversation. Thinking effort sets how hard reasoning models think: Auto lets the provider decide, higher efforts answer harder questions better and cost more.",
    group: "ai",
    settingIds: ["adcode.ai.model", "adcode.ai.effort"],
    related: ["adcode.ai.provider", "ai.connect"],
  },
  {
    id: "adcode.ai.chatWidget",
    title: "AI chat workspace",
    plain: "A conversation workspace with searchable history, a live working block per answer, copyable code blocks, per-response actions, a jump-to-latest pill, and an interrupted banner with Edit prompt and Try again.",
    why: "Asking in the editor beats copying code into a browser, because the assistant can already see the project. A playful mascot, a scroll pill that respects your place, and a clear way back from an interrupted turn keep long runs feeling alive instead of hung.",
    how: "Open Assistant from the workbench or command palette. Write in the composer and send your request. While it works, one activity block per answer shows the current step with elapsed time — the blue mascot bounces while working, its eyes follow your pointer, and clicking it pops a morale-boosting quip. Thinking notes and tool calls stream in as bordered rows, each tool gaining a checkmark when done. When it finishes the block collapses to Worked for Ns; select its header to expand it again. Scroll up and the transcript stays pinned while a Jump to latest pill appears with a count of new messages; select it to return to the tail. If you stop a turn, an interrupted banner offers Edit prompt (your last message back in the composer) and Try again. If a turn fails, a card in the conversation says why in plain words - a rate limit, a request too large for the model, a rejected key, a broken tool call, a network problem - with buttons to try again, switch model, start fresh or report it, and the provider’s exact message under Details. A failed turn never breaks the conversation: the next message works as normal. Code arrives in labelled blocks with a Copy button and inline commands read as pills. Every response offers icon actions for Copy, Read aloud, helpful or not helpful, and Retry, with relative time like just now. Use History to browse conversations and the activity panel to see agent work. Share copies the conversation as markdown. Toggle either side panel for more conversation space. Escape closes the workspace without losing the conversation. The assistant changes existing files with exact replacements instead of rewriting them, reads several files at once, and works through up to 50 steps per request, and Keep going until done carries it on past that by itself. Its edits land in your files as it works, and each turn that changed files gets an Undo card. On an empty conversation, starters - Explain this project, Build something, Fix an error, Plan new idea and Multitask - get going in one click, and in Vibe a short checklist shows anything still missing, such as opening a project folder or connecting a model.",
    group: "ai",
    settingIds: ["adcode.ai.chatWidget"],
    related: ["ai.sessions", "adcode.ai.inlineCompletion", "adcode.ai.memoryCapture"],
  },
  {
    id: "adcode.ai.inlineCompletion",
    title: "Inline completion",
    plain: "Grey text appears ahead of your cursor guessing the rest of what you are writing. Press Tab to take it.",
    why: "For the lines that are boring and predictable, which is more of them than anybody likes to admit.",
    how: "Off by default. Turn it on and ADCode asks the selected model after you pause, without delaying a keystroke, and cancels the request as soon as the buffer changes. Press Tab to accept grey ghost text, keep typing to ignore it, or press Alt+\\ to request a suggestion yourself. Local keyword and language-server suggestions continue to work separately.",
    group: "ai",
    settingIds: ["adcode.ai.inlineCompletion"],
    shortcut: "Alt+\\",
    related: ["adcode.editing.suggestions", "adcode.ai.provider"],
  },
  {
    id: "adcode.ai.terminalAgentDetection",
    title: "Terminal agent detection",
    plain:
      "If you start an AI tool in ADCode's terminal, ADCode notices and offers to share what it knows about the project with it.",
    why: "So the assistant in your terminal and the one in your editor are working from the same notes instead of two different ideas of the project.",
    how: "On by default. When an agent is recognised, a strip appears above the terminal with the one command that connects it. Nothing is shared unless you press it.",
    group: "ai",
    settingIds: ["adcode.ai.terminalAgentDetection"],
    related: ["adcode.ai.mcpServer", "adcode.ai.memoryCapture"],
  },
  {
    id: "adcode.ai.memoryCapture",
    title: "Memory capture",
    plain:
      "The assistant writes down decisions and conventions about your project, so it does not need telling twice.",
    why: "Explaining the same thing at the start of every conversation is the main reason AI assistants feel forgetful.",
    how: "On by default. Memories are plain markdown files in your project folder - you can read them, edit them, and delete them like any other file. Settings shows you where they are.",
    group: "ai",
    settingIds: ["adcode.ai.memoryCapture"],
    related: ["adcode.ai.mcpServer", "ai.sessions"],
  },
  {
    id: "ai.terminalTeam",
    title: "Team in the terminal",
    plain:
      "Split one task across several agent CLIs - Claude Code, Codex, Grok, Kimi and the rest - each working in its own terminal pane.",
    why:
      "You already pay for more than one of these, and they are good at different things. Running them one after another wastes the ones that are idle; running them by hand means writing the same briefing four times and watching four panes to see who has finished.",
    how:
      "Right-click a terminal and choose Start a Team here, or run Set Up AI Team. Describe the task, then pick which CLI takes which role. ADCode opens a pane per role, starts that CLI, and briefs it with its own piece, the acceptance criteria, and what its teammates have already finished. A task only starts once everything it depends on has reported done. Each agent is asked to print one line when it finishes; an agent that goes quiet for five minutes is treated as finished instead. Nothing is sandboxed - these are your CLIs editing your working tree, which is why you confirm the plan first. Closing a pane fails just that task and leaves the others running.",
    group: "ai",
    settingIds: [],
    related: ["ai.team", "adcode.ai.terminalAgentDetection", "adcode.ai.autoContinue"],
  },
  {
    id: "adcode.ai.autoContinue",
    title: "Continue terminal AI after limits",
    plain:
      "A detected terminal assistant can receive a literal “continue” after it says a usage or rate limit has reset.",
    why:
      "Long-running terminal tasks should not need you to watch the clock and return only to type one word.",
    how:
      "Off by default. When enabled, ADCode reads only the terminal output already visible in its own terminal. A clear usage-limit message with an explicit retry delay schedules one continuation. Unknown reset times and changed or ambiguous terminal state stop safely. A repeated limit may schedule the next attempt up to your retry cap. Closing ADCode or turning this setting off cancels every pending continuation.",
    group: "ai",
    settingIds: ["adcode.ai.autoContinue", "adcode.ai.autoContinueRetries"],
    related: ["adcode.ai.terminalAgentDetection", "adcode.ai.mcpServer"],
  },
  {
    id: "adcode.ai.scheduledMessages",
    title: "Scheduled AI messages",
    plain:
      "Write a prompt now and ask a supported AI target to receive it later while ADCode is open.",
    why:
      "A reminder that can actually reach the assistant is useful for follow-up reviews, delayed provider windows, and work you want to queue without leaving an agent running.",
    how:
      "Choose Schedule beside the chat composer, choose where to send the message and set a local time, then confirm. Built-in chat is always available. For a detected terminal AI, first choose Allow next schedule while its prompt is visibly waiting; later terminal activity removes that one-time permission. If ADCode, the project, or scheduled messages are unavailable at delivery time, the message is marked missed and waits for you to choose Run now.",
    group: "ai",
    settingIds: ["adcode.ai.scheduledMessages"],
    related: ["adcode.ai.autoContinue", "adcode.ai.chatWidget"],
  },
  {
    id: "adcode.ai.mcpServer",
    title: "MCP server",
    plain:
      "Lets AI tools outside ADCode - Claude Code, Codex, and others - read and write the same project notes.",
    why: "One set of notes shared by every assistant you use, rather than each one starting from nothing.",
    how: "On by default. Settings shows the exact command to run once, from your project folder, with a Copy button. That is the whole setup.",
    group: "ai",
    settingIds: ["adcode.ai.mcpServer"],
    related: ["adcode.ai.memoryCapture", "adcode.ai.terminalAgentDetection"],
  },
  {
    id: "adcode.ai.customBaseUrl",
    title: "Custom endpoint",
    plain:
      "Point ADCode at any AI service by pasting its address - including one running on your own computer.",
    why: "Most services speak the same format, so one address is all it takes to use a gateway, a cheaper host, or a model you run yourself.",
    how: "Set Provider to Custom, paste the address, and give it your key. The Connect screen checks it works before saving.",
    group: "ai",
    settingIds: ["adcode.ai.customBaseUrl"],
    related: ["ai.connect", "adcode.ai.provider"],
  },
  {
    id: "adcode.ai.isolatedWorkspaces",
    title: "AI file tools",
    plain:
      "The assistant reads, edits and runs commands directly in your open project. What it does lands in your real files as it works, and every turn can be undone.",
    why: "Isolation kept edits safe but made simple work feel missing: proposals sat in a sandbox queue instead of reaching the folder. Direct edits deliver real results the moment the turn finishes.",
    how: "On by default. Ask it to build, fix, create or change files and the result is in your project, with the Explorer refreshing to show it. Reads never change anything. Writes are still guarded: unsaved files pause file edits until you save, so nothing you have not saved gets overwritten, and destructive shell commands stay blocked — run those yourself in the terminal. Chats belong to the open folder only: the chat banner names the folder with its task and chat counts, and Switch opens the folder popup. Turning this off keeps chat available but disables the built-in file tools. Beyond reading, listing, and searching files, the assistant can find files by pattern (for example every image), outline a file's symbols before reading it, run tests and typechecks in the project, and fetch documentation pages.",
    group: "ai",
    settingIds: ["adcode.ai.isolatedWorkspaces"],
    related: ["adcode.ai.chatWidget", "adcode.ai.taskTokenBudget"],
  },
  {
    id: "adcode.ai.editPolicy",
    title: "AI edit approval",
    plain:
      "Choose how the assistant's edits reach your files: it applies them as it works and you can undo any turn (the default), or each turn's changes wait for you to apply them.",
    why:
      "Most of the time you want the result, not a queue of diffs to approve. Applying automatically lets the assistant build, run and fix in one go - the way Cursor's agent does - and one click still takes a whole turn back. Review is there for the times you want to see a change before it lands.",
    how:
      "Switch at any time from the approval menu in the chat's composer (it reads Auto or Review) or in Settings. Apply automatically is the default: files change as the assistant goes, and when a turn changes files the chat shows them with Undo, which puts every file back as it was before that turn and removes files the turn created. If you edited one of those files afterwards, Undo asks before overwriting your change. Undo covers edits made with the assistant's file tools; what a command it ran did to the disk (an install or a build, say) is not recorded. With Review every change, edits are staged in an isolated copy of the project instead; when the turn ends, one card in the conversation shows everything it changed with Apply all changes, Discard and each file's diff, and nothing reaches your files until you apply. Changes in the sidebar lists anything still waiting.",
    group: "ai",
    settingIds: ["adcode.ai.editPolicy"],
    related: ["adcode.ai.keepGoing", "adcode.ai.isolatedWorkspaces", "adcode.ai.scheduledMessages"],
  },
  {
    id: "adcode.ai.keepGoing",
    title: "Keep going until done",
    plain: "When the assistant stops at its step limit in the middle of a long job, it carries on by itself instead of waiting for you to say Continue.",
    why: "Long builds - a whole site, a refactor across many files - can need more than one turn's worth of steps. With this on, you can hand over a big job and come back to it finished.",
    how: "On by default. Turn it off from the approval menu in the chat's composer or in Settings. When a turn ends at the step limit, ADCode sends Continue for you, up to five times in a row, and says so in the conversation each time. Sending your own message or pressing Stop resets the count. With it off, the assistant stops at its step limit and a Continue button picks up where it left off. Together with Apply automatically, and Automations to schedule the job, work runs start to finish without you.",
    group: "ai",
    settingIds: ["adcode.ai.keepGoing"],
    related: ["adcode.ai.editPolicy", "adcode.ai.scheduledMessages", "adcode.ai.chatWidget"],
  },
  {
    id: "adcode.ai.taskTokenBudget",
    title: "Task token budget",
    plain: "Optionally sets a hard ceiling for one assistant task, checked before each new request can spend your key.",
    why: "Long tool loops and repeated context can cost far more than the first question suggests. Checking the whole request before it starts is safer than warning after the tokens are gone.",
    how: "Paused while the assistant edits directly: with no isolated tasks created, there is nothing to cap, so these rows are disabled. Unlimited stays the default. When caps return, choose 25k, 100k, or 250k, or type any number from 1000 to 10000000 into Custom token budget.",
    group: "ai",
    settingIds: ["adcode.ai.taskTokenBudget", "adcode.ai.taskTokenBudgetCustom"],
    related: ["adcode.ai.isolatedWorkspaces", "adcode.ai.provider"],
  },
  {
    id: "ai.workspaceStorage",
    title: "AI workspace storage",
    plain: "Limits how much disk space task copies use and how long finished sandboxes and rollback checkpoints stay.",
    why: "Project copies can be large, but deleting the only safe way back is worse than filling a quota. ADCode treats active work and rollback checkpoints differently for that reason.",
    how: "Terminal sandboxes are cleaned oldest first. An applied task may lose its sandbox when space is tight, but its only rollback checkpoint is kept. If active work leaves no safe room, ADCode refuses the new task and tells you to raise the quota or discard one.",
    group: "ai",
    settingIds: [
      "adcode.ai.sandboxQuota",
      "adcode.ai.sandboxRetention",
      "adcode.ai.checkpointRetention",
    ],
    related: ["adcode.ai.isolatedWorkspaces", "adcode.ai.taskTokenBudget"],
  },
];
