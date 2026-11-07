/**
 * Plugins and Artifacts: the public plugin directory and the Studio, add-ons for the chat,
 * sidebar and status bar, project artifacts that other people remix and improve, your
 * creator profile, and selling plugins (coming soon).
 */
import type { HelpEntry } from "../types.ts";

export const COMMUNITY_ENTRIES: readonly HelpEntry[] = [
  {
    id: "community.plugins",
    title: "Plugins",
    plain: "Add-ons for ADCode that you install with one click: AI actions, chat commands, skills, themes, and small panels for the chat, sidebar and status bar.",
    why: "Someone has probably already written the prompt, checklist or panel you were about to make. Installing theirs takes seconds, and turning it off is just as fast.",
    how: "Choose Plugins in the Vibe sidebar (in the Code window, run Plugins: Browse from the command palette). Discover starts with eight plugins made by ADCode - Usage meter, Quick prompts, Git at a glance, Focus timer, Problems at a glance, Earnings ticker, Strict reviewer and Explain simply - which install without an account, then the community directory by category. Open any plugin to see exactly what it adds before installing. AI actions appear in the command palette (Ctrl+Shift+P), chat commands behind / in the chat, skills are used by the assistant when a task matches, add-ons appear where they belong, and a theme recolours the app. Installing shows its progress on the button - Downloading, then Installing - and ends with a check. The Installed tab turns each plugin on or off, updates it and uninstalls it; turning one off puts back any setting it changed. Settings, on a plugin's row, changes the options its creator gave it, such as a timer's length; changes apply at once. Versions lists every published version with its notes: install an older one and ADCode keeps it there, offering no updates until you switch Keep this version off. Plugins cannot change your model, keys, ads, updates or tool approvals. Report sends a community listing for review; five reports hide it.",
    group: "workbench",
    settingIds: [],
    related: ["community.addons", "community.studio", "ai.composerCommands"],
  },
  {
    id: "community.addons",
    title: "Add-ons",
    plain: "Small panels a plugin adds to the chat, the sidebar or the status bar - a usage meter, a focus timer, one-click prompts.",
    why: "The thing you check twenty times a day should sit where you are already looking, not one menu away.",
    how: "Open Plugins › Discover and choose Add-ons, or install one from Made by ADCode: Usage meter and Quick prompts sit above the chat's message box, Git at a glance in the sidebar, and Focus timer, Problems at a glance and Earnings ticker in the status bar. Each runs sealed in a frame of its own: it has no internet, cannot read your files or account, and sees only the data listed when you install it - your AI usage as a percentage of this session's and this week's allowance with your plan, how full the open conversation is, whether you are signed in, the branch and changed-file count, the open file's name and line, its error count, the project name, the model or your earnings. Its buttons can run only the ADCode commands it declared, and it can put a prompt in the message box but never send one. To build one, choose Add… › Add-on in the Studio: write HTML and an inline script that uses adcode.on(\"data\", …), adcode.run(…), adcode.prompt(…), adcode.store and adcode.options. Turn a plugin off on the Installed tab to remove its add-on.",
    group: "workbench",
    settingIds: [],
    related: ["community.plugins", "community.studio"],
  },
  {
    id: "community.studio",
    title: "Plugin Studio",
    plain: "Make your own plugin, or your own version of any built-in feature, and share it with everyone.",
    why: "When ADCode does something almost the way you want - a /review that is not strict enough, a panel you wish was always visible - you can change it yourself, and everyone with the same wish can use your version.",
    how: "Open Plugins › Studio. Describe a plugin and press Build with AI: the assistant writes adcode-plugin.json in the open project, then Load adcode-plugin.json brings it in. Or use Add… to insert an add-on, AI action, slash command, skill, macro, theme or setting preset, and edit the JSON; the panel beside it lists anything to fix and previews what the plugin adds. Give your plugin its own settings with an \"options\" list - toggles, numbers, text or choices - and people change them on the Installed tab; add-ons read them as adcode.options, and prompts use them as {{option-id}}. To change a built-in feature, choose Customize a built-in feature…, or Customize on any card in All Features: its switches become a preset, its commands a macro, and its chat commands (/review, /commit and the rest) overrides whose instructions you can rewrite. Open any plugin made by ADCode in the Studio to see how it is built. Try it here installs it on this computer only. Publish puts it in the directory under your name; publish again with a higher version to update everyone who installed it. Save to project keeps the file with your code.",
    group: "workbench",
    settingIds: [],
    related: ["community.plugins", "community.addons", "community.monetize"],
  },
  {
    id: "community.artifacts",
    title: "Artifacts",
    plain: "Share a project so anyone on ADCode can remix it and send improvements back. Make it public or private, invite friends with a share code, and work together in a live room.",
    why: "Getting help usually means giving someone access to your repository. An artifact lets strangers improve your project without any access at all: you see every changed line and decide. A live room goes one step further and lets invited friends watch the shared plan, comments and each other's agent lanes while the work happens.",
    how: "Choose Artifacts in the Vibe sidebar (or Artifacts: Share This Project in the palette), open This project and press Share this project. ADCode shares only the project's own text files: anything your .gitignore leaves out, hidden folders like .local and .config, .env files, keys, node_modules, build output, images and lockfiles stay on your machine, and opening your home folder or a whole drive is refused outright. A file that looks like it holds a key or password is listed at the top of the dialog with Leave these files out. Choose Public to list it in Discover, or Private to keep it unlisted: a private artifact opens only for a signed-in person who has its adartifact: share code. After publishing, Sharing and live shows the code, copies it or a ready invitation, rotates it if it leaked, and changes visibility later. Discover also has Open a shared artifact for pasting a code you were sent. Anyone can Remix a shared project: ADCode copies it into Documents -> ADCode Projects and opens it. After changing things, This project lists the changed files and offers Send improvement, with Ask AI to describe it for the message. Inbox shows what people sent you; open one to read each file's changes, Ask AI to review it, then Accept or Decline with a reply. An accepted improvement becomes the next version and credits its author; Get version N on This project brings it into your folder, leaving any file you edited meanwhile alone. For live work, open Live room on This project (owner) or on a shared artifact you can access. The owner starts the room; everyone joins with the same share code, sees who is present and what each agent is doing, edits one shared plan, keeps pinned Brain notes, comments, and chats. Start live files to share the owner's collaborative file session, or join it on the host's side; teammates can take over a lane or hand it back. Closing the room makes it read-only and can be started again later.",
    group: "workbench",
    settingIds: [],
    related: ["community.profile", "community.plugins"],
  },
  {
    id: "community.profile",
    title: "Creator profile",
    plain: "Your level, points, badges and streak, plus everything that happened to what you shared: installs, stars, remixes and improvements.",
    why: "Seeing that forty people installed your plugin, or that your fix was accepted into someone's project, is the reason to build the next one.",
    how: "Open Plugins › Your plugins or Artifacts › Your artifacts, or click the level chip beside the search box. Points come from installs (1), stars (3), remixes (5), each plugin or artifact you publish (10), and each improvement of yours someone accepts (20). Levels run from Newcomer to Legend; the bar shows how far the next one is. Badges mark firsts and milestones, and the streak counts days in a row you published, remixed or improved something. Each page lists its own activity, and the sidebar entries show a count when something new happened. Open one of your plugins to edit it as the next version, or unpublish it - people who installed it keep their copy.",
    group: "workbench",
    settingIds: [],
    related: ["community.artifacts", "community.studio"],
  },
  {
    id: "community.monetize",
    title: "Sell your plugins (coming soon)",
    plain: "Soon you will be able to put a price on a plugin and get paid for it. You can join the waitlist today.",
    why: "If you build something people rely on every day, you should be able to earn from it. Joining now tells us what price creators want and puts you first in line.",
    how: "Open Plugins › Studio and find Sell your plugins at the bottom of the right-hand column, or the same card on Your plugins. Enter the price you would charge, or leave it empty, and press Join the waitlist. The card shows your place in line and how many creators are waiting. Selling is not available yet: every plugin in the directory is free, and plugins that are free today will stay free.",
    group: "workbench",
    settingIds: [],
    related: ["community.studio", "account.earnings"],
  },
];
