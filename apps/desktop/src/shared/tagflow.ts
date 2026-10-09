/**
 * Tag Flow AI, as both processes need to know it: no I/O, so the rules are tested as written.
 *
 * Tag Flow AI is an ADCode partner whose models every install can use with no key, through
 * ADCode's own server (`services/api/src/tagflow.ts`). Its privacy policy and terms apply when
 * somebody uses its models, so wherever it is offered the app says so and links both.
 */

export const TAGFLOW_ID = "tagflow";
export const TAGFLOW_NAME = "Tag Flow AI";
export const TAGFLOW_SITE = "https://tagflow-ai.com";

/** The partner a provider is run by, for the notice beside it. */
export interface PartnerView {
  readonly name: string;
  readonly privacyUrl: string;
  readonly termsUrl: string;
}

/** The admin panel's Tag Flow settings, as far as this needs them. */
interface PartnerSettings {
  readonly privacyUrl: string;
  readonly termsUrl: string | null;
}

/** Tag Flow's notice: its privacy policy, and its terms - or its site, until it publishes them. */
export function partnerOf(settings: PartnerSettings): PartnerView {
  return { name: TAGFLOW_NAME, privacyUrl: settings.privacyUrl, termsUrl: settings.termsUrl ?? TAGFLOW_SITE };
}

/**
 * The provider somebody is on before they have chosen one.
 *
 * A fresh install starts on Tag Flow, so the first thing typed gets an answer. Anthropic was
 * the silent default before, so somebody who saved an Anthropic key and never picked a
 * provider keeps it; with Tag Flow switched off, everybody gets the old default.
 */
export function impliedProvider(input: { readonly anthropicKeySaved: boolean; readonly tagflowEnabled: boolean }): string {
  return input.tagflowEnabled && !input.anthropicKeySaved ? TAGFLOW_ID : "anthropic";
}

/**
 * The provider a turn actually uses, from what is stored.
 *
 * "anthropic" is also what every install stored as the old default, so it counts as a choice
 * only with an Anthropic key behind it. Until the keychain has answered (`null`), nothing moves
 * to Tag Flow: sending somebody's code to a third party they did not choose, even once, is
 * worse than a moment of "not connected".
 */
export function effectiveProvider(input: {
  readonly stored: string;
  readonly anthropicKeySaved: boolean | null;
  readonly tagflowEnabled: boolean;
}): string {
  const stored = input.stored.trim();
  if (stored.length > 0 && stored !== "anthropic") return stored;
  if (input.anthropicKeySaved === null) return "anthropic";
  if (stored === "anthropic" && input.anthropicKeySaved) return "anthropic";
  return impliedProvider({ anthropicKeySaved: input.anthropicKeySaved, tagflowEnabled: input.tagflowEnabled });
}

/** One run of the partner notice: words, or words that link. */
export type NoteSegment = { readonly text: string } | { readonly text: string; readonly href: string };

/** "Tag Flow AI is an ADCode partner. Their Privacy Policy and Terms apply when you use their models." */
export function partnerNoteSegments(partner: PartnerView): NoteSegment[] {
  return [
    { text: `${partner.name} is an ADCode partner. Their ` },
    { text: "Privacy Policy", href: partner.privacyUrl },
    { text: " and " },
    { text: "Terms", href: partner.termsUrl },
    { text: " apply when you use their models." },
  ];
}
