/**
 * Fuzzy file matching and workspace text search.
 *
 * Brief §4's Navigation group: fuzzy file open and global regex search. No Electron and
 * no DOM, so the ranking quality and the §7 performance budget are both testable without
 * launching an editor.
 */
export {
  fuzzyMatch,
  rankCandidates,
  type FuzzyMatch,
  type RankedCandidate,
} from "./fuzzy.ts";

export {
  createWorkspaceSearch,
  type ReplaceSummary,
  type SearchQuery,
  type SearchResult,
  type WorkspaceSearch,
  type WorkspaceSearchDeps,
} from "./textSearch.ts";
