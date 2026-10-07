/**
 * When the legal pages last changed.
 *
 * Here rather than in the pages because the sitemap needs them too, and a page file may
 * only export what Next expects of a page. Change the date and the label together - the
 * pages print both, and a document whose job is to record what was true when must not
 * disagree with itself about when.
 */
export const PRIVACY_UPDATED = { iso: "2026-10-07", label: "7 October 2026" } as const;
export const TERMS_UPDATED = { iso: "2026-10-07", label: "7 October 2026" } as const;
