/**
 * What an explanation is.
 *
 * The product has a settings screen with fifty-five switches on it and, until now, no
 * answer anywhere to "what is sticky scroll". A description written for the settings row
 * has to be short enough to sit under a label, which makes it a reminder for somebody who
 * already knows rather than an explanation for somebody who does not.
 *
 * So an entry carries three fields instead of one, and they are three different jobs:
 *
 * - `plain` is the sentence a child would understand. No jargon, no product nouns, no
 *   "leverages" or "surfaces". If it needs a comma-spliced clause to survive, it is wrong.
 * - `why` is when a person would want it. This is the field that decides whether somebody
 *   flips the switch, and it is the one most documentation never writes.
 * - `how` is what to actually do, including the keys to press.
 *
 * Splitting them is not decoration: the settings popover shows all three, the guide shows
 * all three as a card, and the website's docs page uses `plain` as the summary search
 * engines index. One string could not have done all of that.
 */
import type { SettingGroupId } from "@adcode/settings";

/**
 * Where an entry belongs.
 *
 * The settings groups, plus three of our own for the things that have no switch: the
 * workbench furniture, the account and earnings surfaces, and the editor's own gestures.
 * A feature with no setting still needs explaining - arguably more, since there is no row
 * to read it off.
 */
export type HelpGroupId = SettingGroupId | "workbench" | "account" | "gestures";

export interface HelpEntry {
  /** Unique. A settings id where one exists, otherwise a dotted name in the same shape. */
  readonly id: string;
  readonly title: string;
  /** One sentence, plain enough for a child. */
  readonly plain: string;
  /** When somebody would want this. */
  readonly why: string;
  /** What to do, including which keys. */
  readonly how: string;
  readonly group: HelpGroupId;
  /**
   * The settings this entry explains.
   *
   * Usually one, occasionally several - "suggestions as you type" and "accept with Enter"
   * are two rows describing one behaviour, and explaining either without the other leaves
   * the reader with half of it. Empty for features that have no switch.
   */
  readonly settingIds: readonly string[];
  /** As written in the keybindings model, e.g. "CmdOrCtrl+P". */
  readonly shortcut?: string;
  /** Other entry ids worth reading next. */
  readonly related: readonly string[];
}

/** A catalogue action that delegates to the desktop command registry. */
export interface FeatureCommandAction {
  readonly kind: "command";
  readonly command: string;
  readonly label: string;
}

/** A catalogue action that deep-links to one exact Settings row. */
export interface FeatureSettingAction {
  readonly kind: "setting";
  readonly settingId: string;
  readonly label: string;
}

export type FeatureAction = FeatureCommandAction | FeatureSettingAction;

/** One user-recognisable capability, its explanation, and the safe ways into it. */
export interface FeatureRecord {
  readonly entry: HelpEntry;
  readonly actions: readonly FeatureAction[];
  readonly keywords: readonly string[];
}
