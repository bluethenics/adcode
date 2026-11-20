/** What ADCode learns about how it is used, and how to stop it. */
import type { HelpEntry } from "../types.ts";

export const PRIVACY_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.privacy.usageStats",
    title: "Help improve ADCode",
    plain: "Lets ADCode learn which features you use, and where it goes wrong for you - a failed AI request, a limit, a crash - so the team can fix what makes people give up. Only fixed names, codes, counts and timings are sent.",
    why: "A feature nobody uses is either not needed or not findable, and somebody who quietly stops using ADCode usually hit something first: an error, a limit, a sign-in that went nowhere. These counts and signals are the only way the team can see which, and fix it. Leave it on to have your experience shape what gets fixed; turn it off and nothing is counted or sent.",
    how: "It is on by default. To turn it off, open Settings › Privacy and switch off Help improve ADCode, or search for it in All Features. While it is on, two things are sent. Feature counts: which commands run, which pages open (Chat, Plugins, Artifacts and the rest), product moments such as installing a plugin, and which directory add-ons are used - fixed names with a count per day, sent once a day and stored without your account. Retention signals, linked to your ADCode account id so the team can see who stops coming back and why: your first launch, signing in, opening a project, your first AI message, the first AI answer that worked, the first AI edit applied, opening a preview, each day you use ADCode, the app version, and how each session ended (quit, restart to update, or never quit). And what went wrong: a failed AI request with a fixed error word such as auth or network, a CLI agent that failed or stopped part way, a limit screen, No API key, a sign-in that failed or was needed, a first answer slower than 20 seconds, a cancelled request, a crash and a failed update - each with a time, and some with a duration in milliseconds. What is never sent: your code, prompts, AI replies, file or folder names, paths, project names, error messages, chat text, the plugins you tried privately in the Studio, or anything you typed. Raw signals are kept for 90 days; after that only per-account totals remain. Switching it off stops both at once and deletes anything not sent yet.",
    group: "privacy",
    settingIds: ["adcode.privacy.usageStats"],
    related: ["account.signIn"],
  },
];
