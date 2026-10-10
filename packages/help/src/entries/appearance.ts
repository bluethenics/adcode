/**
 * Appearance: how much room things take, whether it is light or dark, how big, how much it
 * moves, and how the chat's agents look.
 */
import type { HelpEntry } from "../types.ts";

export const APPEARANCE_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.appearance.density",
    title: "Density",
    plain: "How much space there is between things. Comfortable is roomier; compact fits more on screen.",
    why: "Generous spacing looks good on a large monitor and wastes a laptop screen.",
    how: "Pick Comfortable or Compact. It changes immediately, everywhere.",
    group: "appearance",
    settingIds: ["adcode.appearance.density"],
    related: ["adcode.appearance.theme"],
  },
  {
    id: "adcode.appearance.theme",
    title: "Appearance",
    plain: "Warm light, charcoal dark, or midnight. System follows your computer's appearance.",
    why: "Dark is easier at night, light is easier in daylight, and following the system means you never think about it.",
    how: "Light is the default for new installs. Choose Dark, Midnight, or System in Settings. Your explicit preference stays selected across modes.",
    group: "appearance",
    settingIds: ["adcode.appearance.theme"],
    related: ["adcode.appearance.density"],
  },
  {
    id: "adcode.appearance.zoom",
    title: "Zoom",
    plain: "Makes the whole window bigger or smaller - menus, panels, buttons and text together.",
    why: "On a big monitor across the room everything is tiny; on a small laptop you want more on screen. Zoom fixes both without touching your computer's display settings.",
    how: "Press Ctrl+= to zoom in, Ctrl+- to zoom out, and Ctrl+0 to go back to 100% (Cmd on a Mac). It steps through 80% to 200%, and the status bar says where you are. View > Appearance has the same three, and Settings > Appearance > Zoom lets you pick a size directly. Your choice is kept for next time.",
    group: "appearance",
    settingIds: ["adcode.appearance.zoom"],
    shortcut: "CmdOrCtrl+=",
    related: ["adcode.appearance.textSize", "adcode.appearance.density"],
  },
  {
    id: "adcode.appearance.textSize",
    title: "Text size",
    plain: "Makes the words you read bigger or smaller - code in the editor, the terminal and chat messages - while the rest of the window stays the same size.",
    why: "When the code is hard to read, zooming the whole window costs you sidebar and panel space for nothing. Text size grows only the reading text.",
    how: "Press Ctrl+Shift+. (the > key) for bigger text and Ctrl+Shift+, (the < key) for smaller - the same keys Word uses for font size. View > Appearance > Reset Text Size goes back to Default. Settings > Appearance > Text size has five sizes from Small to Largest. It applies at once to every editor, terminal and chat, and is kept for next time.",
    group: "appearance",
    settingIds: ["adcode.appearance.textSize"],
    shortcut: "CmdOrCtrl+Shift+.",
    related: ["adcode.appearance.zoom"],
  },
  {
    id: "adcode.appearance.motion",
    title: "Motion",
    plain: "Turns the window's animation down or up: messages rising in, mascots moving, and code typing into live windows.",
    why: "Movement helps some people follow what changed and makes others feel unwell or distracted. Your computer may already have a reduce-motion setting; this lets ADCode follow it or not.",
    how: "Settings > Appearance > Motion. Follow system uses your computer's reduce-motion setting. Reduce keeps everything still and shows changes at once - live windows show the finished code instead of typing it. Full keeps the animation even when the system asks for less.",
    group: "appearance",
    settingIds: ["adcode.appearance.motion"],
    related: ["adcode.appearance.theme"],
  },
  {
    id: "ai.chatAppearance",
    title: "Customise chat",
    plain: "Choose the assistant's name and face, whether replies show who wrote them, and how replies sit on the page.",
    why: "A chat you spend hours in should look the way you like. Faces and names also make it obvious which agent said what once several are working.",
    how: "Select Customise in the chat's header (or ••• when the chat is docked), or run AI: Customise Chat from the command palette. Type a name, pick one of eight shapes and ten colours, and choose a reply style: Document runs replies full width, Bubbles puts each in a soft card, Compact fits more on screen. Show who is replying adds the face and name above replies; while a reply is still being written the name stands alone, because the face at work is the mascot in the activity block. A live preview shows the result before you save. Saved agents keep their own look - change theirs in the agent editor on the Agents board. Every choice is also in Settings > Appearance.",
    group: "appearance",
    settingIds: [
      "adcode.appearance.assistantName",
      "adcode.appearance.assistantShape",
      "adcode.appearance.assistantColor",
      "adcode.appearance.agentAvatars",
      "adcode.appearance.messageStyle",
    ],
    related: ["ai.agentMascots", "ai.liveAgents"],
  },
];
