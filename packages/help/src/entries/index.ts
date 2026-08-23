/**
 * The catalogue, assembled.
 *
 * Split by group rather than kept in one file because a single list of seventy entries is
 * a file nobody opens willingly, and because the group a thing belongs to is the first
 * question anybody editing this has.
 *
 * Order matters: it is the order the guide and the docs sidebar render in, and it follows
 * the settings screen's own group order so the two screens agree.
 */
import type { HelpEntry } from "../types.ts";
import { ADS_ENTRIES } from "./ads.ts";
import { AI_ENTRIES } from "./ai.ts";
import { APPEARANCE_ENTRIES } from "./appearance.ts";
import { EDITING_ENTRIES } from "./editing.ts";
import { FORMATTING_ENTRIES } from "./formatting.ts";
import { GIT_ENTRIES } from "./git.ts";
import { LANGUAGE_ENTRIES } from "./language.ts";
import { NAVIGATION_ENTRIES } from "./navigation.ts";
import { SESSION_ENTRIES } from "./session.ts";
import { UPDATES_ENTRIES } from "./updates.ts";
import { WORKBENCH_ENTRIES } from "./workbench.ts";

export const HELP_ENTRIES: readonly HelpEntry[] = [
  ...ADS_ENTRIES,
  ...APPEARANCE_ENTRIES,
  ...EDITING_ENTRIES,
  ...FORMATTING_ENTRIES,
  ...GIT_ENTRIES,
  ...NAVIGATION_ENTRIES,
  ...LANGUAGE_ENTRIES,
  ...SESSION_ENTRIES,
  ...UPDATES_ENTRIES,
  ...AI_ENTRIES,
  ...WORKBENCH_ENTRIES,
];
