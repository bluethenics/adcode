/**
 * The community hub: the public plugin directory, the plugin Studio, project artifacts that
 * other people remix and improve, your creator profile, and selling plugins (coming soon).
 */
import type { HelpEntry } from "../types.ts";

export const COMMUNITY_ENTRIES: readonly HelpEntry[] = [
  {
    id: "community.hub",
    title: "Community",
    plain: "One place for plugins other ADCode users made, projects they shared for you to remix, and your own creator profile.",
    why: "The fastest way to get better at building is to borrow what already works and give back what you improved. This is where that happens without leaving the editor.",
    how: "Choose Community in the Vibe sidebar (in the Code window, run Community: Open from the command palette). Discover shows featured and trending plugins, projects asking for help, and three doors: Build a plugin, Share this project, Help someone. Search at the top looks through plugins and artifacts. The You tab shows your level, badges, streak and activity, with a count on the sidebar entry when something new happened. Reading the directory needs no account; installing, publishing, starring and sending improvements need a signed-in ADCode account with a verified email.",
    group: "workbench",
    settingIds: [],
    related: ["community.plugins", "community.artifacts", "community.studio", "community.profile"],
  },
  {
    id: "community.plugins",
    title: "Plugin directory",
    plain: "A public list of add-ons other people built for ADCode - AI actions, chat commands, skills, themes - that you install with one click.",
    why: "Someone has probably already written the prompt, review checklist or colour scheme you were about to make. Installing theirs takes seconds, and you can turn it off or remove it just as fast.",
    how: "Open Community and choose Plugins. Sort by Trending, New or Most used, or pick a category. Open a plugin to see exactly what it adds before you install it. Install asks once and lists every change. Its AI actions appear in the command palette (Ctrl+Shift+P), its chat commands behind / in the chat, its skills are used by the assistant when a task matches, and its theme recolours the app. The Installed list at the top turns each plugin on or off and uninstalls it; turning one off puts back any setting it changed. Check for updates finds newer versions, and people who installed a plugin are told when its creator publishes one. Plugins are JSON - prompts, skills, colours and setting values - never programs, so a plugin cannot run code, read your files on its own, or change your model, keys, ads or tool approvals. Report sends a listing for review; five reports hide it.",
    group: "workbench",
    settingIds: [],
    related: ["community.studio", "community.hub", "ai.composerCommands"],
  },
  {
    id: "community.studio",
    title: "Plugin Studio",
    plain: "Make your own plugin, or your own version of any built-in feature, and share it with everyone.",
    why: "When ADCode does something almost the way you want - a /review that is not strict enough, an editor set up the wrong way for your team - you can change it yourself instead of waiting, and everyone with the same wish can use your version.",
    how: "Open Community and choose Studio. Describe a plugin and press Build with AI: the assistant writes adcode-plugin.json in the open project, then Load adcode-plugin.json brings it into the editor. Or use Add… to insert an AI action, slash command, skill, macro, theme or setting preset, and edit the JSON directly; the panel beside it lists anything to fix and previews what the plugin adds. To change a built-in feature, choose Remix a built-in feature… here, or Customize on any card in All Features: its switches become a preset, its commands a macro, and its chat commands (/review, /commit and the rest) overrides whose instructions you can rewrite. Try it here installs it on this computer only. Publish puts it in the directory under your name; publish again with a higher version to update everyone who installed it. Remix in Studio on another person's plugin starts a copy that credits theirs. Save to project keeps the file with your code.",
    group: "workbench",
    settingIds: [],
    related: ["community.plugins", "community.monetize", "ai.composerCommands"],
  },
  {
    id: "community.artifacts",
    title: "Project artifacts",
    plain: "Share a project so anyone on ADCode can copy it, improve it with their own AI, and send the improvement back for you to accept.",
    why: "Getting help usually means giving someone access to your repository. An artifact lets strangers improve your project without any access at all: you see every changed line and decide.",
    how: "Open a project, then Community › Artifacts › Share this project (or Community: Share This Project in the palette). Give it a title, a description and, if you like, what you would like help with - those projects are listed under Help wanted. Private files (.env, keys), generated folders (node_modules, dist), images and lockfiles stay on your machine, and a file that looks like it contains a key or password blocks sharing until you move it into .env. Anyone can Remix it: ADCode copies the latest version into Documents › ADCode Projects and opens it. After changing things, the Artifacts tab shows how many files changed and offers Send improvement, with Ask AI to describe it for the message. As the owner you review it file by file on the You tab, Ask AI to review it, then Accept or Decline with a reply. An accepted improvement becomes the next version and credits its author; Get version N brings it into your own folder, leaving any file you edited meanwhile alone. Get latest does the same for a remix when the original moves on.",
    group: "workbench",
    settingIds: [],
    related: ["community.profile", "community.hub"],
  },
  {
    id: "community.profile",
    title: "Creator profile",
    plain: "Your level, points, badges and streak, plus everything that happened to what you shared: installs, stars, remixes and improvements.",
    why: "Seeing that forty people installed your plugin, or that your fix was accepted into someone's project, is the reason to build the next one.",
    how: "Open Community and choose You (or click the level chip beside the search box). Points come from installs (1), stars (3), remixes (5), each plugin or artifact you publish (10), and each improvement of yours someone accepts (20). Levels run from Newcomer to Legend; the bar shows how far the next one is. Badges mark firsts and milestones, and the streak counts days in a row you published, remixed or improved something. Improvements for you lists what people sent to your artifacts, waiting ones first; Improvements you sent shows each one's status and the owner's reply. Open one of your plugins to edit it in the Studio as the next version, or unpublish it - people who installed it keep their copy.",
    group: "workbench",
    settingIds: [],
    related: ["community.artifacts", "community.studio"],
  },
  {
    id: "community.monetize",
    title: "Sell your plugins (coming soon)",
    plain: "Soon you will be able to put a price on a plugin and get paid for it. You can join the waitlist today.",
    why: "If you build something people rely on every day, you should be able to earn from it. Joining now tells us what price creators want and puts you first in line.",
    how: "Open Community › Studio and find Sell your plugins at the bottom of the right-hand column, or the same card on the You tab. Enter the price you would charge, or leave it empty, and press Join the waitlist. The card shows your place in line and how many creators are waiting. Selling is not available yet: every plugin in the directory is free, and plugins that are free today will stay free.",
    group: "workbench",
    settingIds: [],
    related: ["community.studio", "account.earnings"],
  },
];
