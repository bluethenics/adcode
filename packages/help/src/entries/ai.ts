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
];
