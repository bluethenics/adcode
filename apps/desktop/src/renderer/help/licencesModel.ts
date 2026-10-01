/**
 * What the Open Source Licences dialog shows, decided without a DOM.
 *
 * Three tabs, always. A document that could not be read still gets its tab, with a sentence
 * saying why and where the text can be found - an empty pane would read as "there is no
 * licence", which is the opposite of the truth.
 */
import type { LicenceDocuments } from "../../shared/api.ts";

export const REPOSITORY_URL = "https://github.com/bluethenics/adcode";

export type LicenceTabId = "licence" | "notice" | "third-party";

export interface LicenceTab {
  readonly id: LicenceTabId;
  readonly label: string;
  readonly text: string;
}

const UNREADABLE =
  `This file could not be read from your installation. ADCode is open source under the ` +
  `Apache License 2.0; the full text is at ${REPOSITORY_URL}/blob/main/LICENSE.`;

const NOTICE_UNREADABLE =
  `This file could not be read from your installation. It is at ` +
  `${REPOSITORY_URL}/blob/main/NOTICE.`;

/** A source checkout: the file is generated at package time, so absence is normal. */
const THIRD_PARTY_NOT_GENERATED =
  `The third-party notices are generated when ADCode is packaged, so a source checkout has ` +
  `them only after packaging. To create them now, run this from the repository root: ` +
  `node scripts/third-party-notices.mjs`;

/** An installed build: the file should be there, so absence means the install is damaged. */
const THIRD_PARTY_UNREADABLE =
  `This file could not be read from your installation. Every package ADCode is built from ` +
  `is listed in its repository, ${REPOSITORY_URL}, and reinstalling ADCode restores this file.`;

export function licenceTabs(documents: LicenceDocuments): readonly LicenceTab[] {
  const thirdPartyMissing = documents.packaged ? THIRD_PARTY_UNREADABLE : THIRD_PARTY_NOT_GENERATED;
  return [
    { id: "licence", label: "ADCode licence", text: documents.licence ?? UNREADABLE },
    { id: "notice", label: "Notice", text: documents.notice ?? NOTICE_UNREADABLE },
    { id: "third-party", label: "Third-party", text: documents.thirdParty ?? thirdPartyMissing },
  ];
}
