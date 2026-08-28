/**
 * AI: the assistant, and the memory it shares with every other agent.
 */
import type { HelpEntry } from "../types.ts";

export const AI_ENTRIES: readonly HelpEntry[] = [
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
    how: "Pick from the list, which shows the models your key can actually reach rather than a fixed set. Switching takes effect on your next message - it does not restart the conversation.",
    group: "ai",
    settingIds: ["adcode.ai.model"],
    related: ["adcode.ai.provider", "ai.connect"],
  },
  {
    id: "adcode.ai.chatWidget",
    title: "Chat widget",
    plain: "A small chat card you can call up to ask questions about the code you are looking at.",
    why: "Asking in the editor beats copying code into a browser, because the assistant can already see the project.",
    how: "On by default. Press the shortcut to summon it, drag its title bar to move it, and press Escape to dismiss it without losing the conversation. Past conversations are kept in the history list beside it.",
    group: "ai",
    settingIds: ["adcode.ai.chatWidget"],
    related: ["ai.sessions", "adcode.ai.inlineCompletion", "adcode.ai.memoryCapture"],
  },
  {
    id: "adcode.ai.inlineCompletion",
    title: "Inline completion",
    plain: "Grey text appears ahead of your cursor guessing the rest of what you are writing. Press Tab to take it.",
    why: "For the lines that are boring and predictable, which is more of them than anybody likes to admit.",
    how: "On by default. Press Tab to accept the suggestion, or just keep typing to ignore it.",
    group: "ai",
    settingIds: ["adcode.ai.inlineCompletion"],
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
      "Choose Schedule beside the chat composer, select an available adapter and local time, then confirm. Built-in chat is always supported. For a detected terminal AI, first choose Allow next schedule while its prompt is visibly waiting; any later terminal activity removes that one-time permission. Compatible internal adapters use the same registration contract. If ADCode, the project, or scheduled messages are unavailable at delivery time, the one-time message is marked missed and does nothing until you choose Run now.",
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
    title: "Isolated AI edits",
    plain:
      "The assistant works in a separate copy of your project. Your real files change only after you review them, with a way back kept first.",
    why: "A model can make a useful mistake very quickly. Isolation lets it read its own edits and keep working without putting unfinished or conflicting changes into the project you are using.",
    how: "On by default. The assistant shows the task state, changed files, and Review button. Accept individual hunks, discard the sandbox, or roll an applied task back. Turning this off keeps chat available but disables the built-in file tools.",
    group: "ai",
    settingIds: ["adcode.ai.isolatedWorkspaces"],
    related: ["adcode.ai.chatWidget", "adcode.ai.taskTokenBudget"],
  },
  {
    id: "adcode.ai.editPolicy",
    title: "AI edit approval",
    plain:
      "Choose whether each AI file change waits for your review or is applied automatically after a successful task turn.",
    why:
      "Review mode gives you hunk-by-hunk control. Trusted mode is faster for projects and agents you are comfortable with, while keeping isolation, overlap checks, and a rollback checkpoint.",
    how:
      "Review every change is the default. Trusted auto-apply never writes during the model turn: ADCode first collects exact proposals in the sandbox, then checkpoints and applies them together. Switch back to Review every change at any time; the next task uses the safer policy. Use Rollback on an applied task to go back, unless later human edits overlap it.",
    group: "ai",
    settingIds: ["adcode.ai.editPolicy"],
    related: ["adcode.ai.isolatedWorkspaces", "adcode.ai.taskTokenBudget"],
  },
  {
    id: "adcode.ai.taskTokenBudget",
    title: "Task token budget",
    plain: "Sets a hard ceiling for one assistant task, checked before each new request can spend your key.",
    why: "Long tool loops and repeated context can cost far more than the first question suggests. Checking the whole request before it starts is safer than warning after the tokens are gone.",
    how: "The default is 100k. The task strip shows reserved tokens. ADCode pauses before the next request would cross the limit; raise it in Settings or start a new task when you want a fresh allowance.",
    group: "ai",
    settingIds: ["adcode.ai.taskTokenBudget"],
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
