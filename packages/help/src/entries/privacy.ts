/** What ADCode learns about how it is used, and how to stop it. */
import type { HelpEntry } from "../types.ts";

export const PRIVACY_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.privacy.usageStats",
    title: "Help improve ADCode",
    plain: "Lets ADCode count which features you use each day, so the team can fix what is hard to find. Only names and numbers are sent.",
    why: "A feature nobody uses is either not needed or not findable, and counts are the only way to tell which. Leave it on to have your use shape what gets improved; turn it off and nothing is counted.",
    how: "It is on by default. To turn it off, open Settings › Privacy and switch off Help improve ADCode, or search for it in All Features. What is counted: which commands run, which pages open (Chat, Plugins, Artifacts and the rest), product moments such as installing a plugin, and which directory add-ons are used - as fixed names with a count per day. What is never sent: your code, prompts, file or folder names, project names, the plugins you tried privately in the Studio, or anything you typed. Counts are kept on your computer and sent once a day as one report, which the service stores without your account. Switching it off deletes anything not sent yet.",
    group: "privacy",
    settingIds: ["adcode.privacy.usageStats"],
    related: ["account.signIn"],
  },
];
