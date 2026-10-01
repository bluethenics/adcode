/**
 * When the legal pages last changed.
 *
 * Here rather than in the pages because the sitemap needs them too, and a page file may
 * only export what Next expects of a page. Change the date and the label together - the
 * pages print both, and a document whose job is to record what was true when must not
 * disagree with itself about when.
 */
export const PRIVACY_UPDATED = { iso: "2026-09-13", label: "13 September 2026" } as const;
export const TERMS_UPDATED = { iso: "2026-09-30", label: "30 September 2026" } as const;
