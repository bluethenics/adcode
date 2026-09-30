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

const THIRD_PARTY_MISSING =
  `The third-party notices are generated when ADCode is packaged, so an installed build ` +
  `always has them and a source checkout has them only after packaging. To create them ` +
  `now, run: node scripts/third-party-notices.mjs`;

export function licenceTabs(documents: LicenceDocuments): readonly LicenceTab[] {
  return [
    { id: "licence", label: "ADCode licence", text: documents.licence ?? UNREADABLE },
    { id: "notice", label: "Notice", text: documents.notice ?? NOTICE_UNREADABLE },
    { id: "third-party", label: "Third-party", text: documents.thirdParty ?? THIRD_PARTY_MISSING },
  ];
}
