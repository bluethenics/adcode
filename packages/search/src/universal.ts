import { fuzzyMatch } from "./fuzzy.ts";

export type UniversalSearchKind = "feature" | "command" | "file" | "symbol" | "recent";

export interface UniversalSearchItem {
  /** Stable across queries; include the kind prefix at the call site. */
  readonly id: string;
  readonly kind: UniversalSearchKind;
  readonly title: string;
  readonly detail?: string;
  readonly keywords?: readonly string[];
}

export interface UniversalSearchLimits {
  readonly perKind?: number;
  readonly total?: number;
}

const KIND_ORDER: Readonly<Record<UniversalSearchKind, number>> = {
  feature: 0,
  command: 1,
  file: 2,
  symbol: 3,
  recent: 4,
};

function searchable(item: UniversalSearchItem): string {
  return [item.title, item.detail ?? "", item.id, ...(item.keywords ?? [])].join(" ");
}

function matchScore(query: string, item: UniversalSearchItem): number | null {
  const title = item.title.trim().toLowerCase();
  const haystack = searchable(item).toLowerCase();
  if (title === query) return 40_000;
  if (title.startsWith(query)) return 30_000 - Math.min(title.length - query.length, 1_000);
  if (haystack.includes(query)) return 20_000 - Math.min(haystack.indexOf(query), 1_000);

  const queryWords = query.split(/\s+/).filter(Boolean);
  const tokenMatches = queryWords.filter((word) => haystack.includes(word)).length;
  if (tokenMatches === queryWords.length && tokenMatches > 1) return 15_000 + tokenMatches * 100;

  const fuzzy = fuzzyMatch(query.replace(/\s+/g, ""), haystack.replace(/\s+/g, ""));
  return fuzzy === null ? null : 10_000 + fuzzy.score;
}

/** Deterministic, bounded ranking over items supplied by every universal-search source. */
export function rankUniversalItems(
  rawQuery: string,
  items: readonly UniversalSearchItem[],
  limits: UniversalSearchLimits = {},
): readonly UniversalSearchItem[] {
  const commandOnly = rawQuery.trimStart().startsWith(">");
  const query = (commandOnly ? rawQuery.trimStart().slice(1) : rawQuery).trim().toLowerCase();
  const perKind = Math.max(1, limits.perKind ?? 8);
  const total = Math.max(1, limits.total ?? 30);
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return !commandOnly || item.kind === "command";
  });

  const ranked = query.length === 0
    ? unique
        .map((item, index) => ({ item, index, score: 0 }))
        .sort((a, b) => KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.index - b.index)
    : unique
        .map((item, index) => ({ item, index, score: matchScore(query, item) }))
        .filter(
          (candidate): candidate is { item: UniversalSearchItem; index: number; score: number } =>
            candidate.score !== null,
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
            a.index - b.index,
        );

  const counts = new Map<UniversalSearchKind, number>();
  const results: UniversalSearchItem[] = [];
  for (const { item } of ranked) {
    const count = counts.get(item.kind) ?? 0;
    if (count >= perKind) continue;
    counts.set(item.kind, count + 1);
    results.push(item);
    if (results.length === total) break;
  }
  return results;
}

export interface UniversalSearchFailure {
  readonly source: UniversalSearchKind;
  readonly message: string;
}

export interface UniversalSearchSnapshot {
  readonly query: string;
  readonly generation: number;
  readonly items: readonly UniversalSearchItem[];
  readonly pending: readonly UniversalSearchKind[];
  readonly failures: readonly UniversalSearchFailure[];
}

export interface UniversalSearchProvider {
  readonly source: UniversalSearchKind;
  readonly minimumQueryLength?: number;
  readonly search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly UniversalSearchItem[]>;
}

export interface UniversalSearchCoordinator {
  search(query: string): Promise<void>;
  close(): void;
}

export interface UniversalSearchCoordinatorDeps {
  readonly local: (query: string) => readonly UniversalSearchItem[];
  readonly providers: readonly UniversalSearchProvider[];
  readonly publish: (snapshot: UniversalSearchSnapshot) => void;
  readonly limits?: UniversalSearchLimits;
}

const failureMessage = (source: UniversalSearchKind): string =>
  `${source[0]!.toUpperCase()}${source.slice(1)} results are unavailable right now.`;

/**
 * Merge immediate local results with asynchronous providers without ever publishing stale
 * work. Providers may honour the abort signal for efficiency; the generation check remains
 * the correctness boundary when a bridge cannot really cancel.
 */
export function createUniversalSearchCoordinator(
  deps: UniversalSearchCoordinatorDeps,
): UniversalSearchCoordinator {
  let generation = 0;
  let controller: AbortController | null = null;

  return {
    async search(query: string): Promise<void> {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const mine = ++generation;
      const local = deps.local(query);
      const providerResults = new Map<UniversalSearchKind, readonly UniversalSearchItem[]>();
      const failures: UniversalSearchFailure[] = [];
      const commandOnly = query.trimStart().startsWith(">");
      const length = query.trim().length;
      const activeProviders = commandOnly
        ? []
        : deps.providers.filter((provider) => length >= (provider.minimumQueryLength ?? 0));
      const pending = new Set(activeProviders.map((provider) => provider.source));

      const publish = (): void => {
        if (mine !== generation || signal.aborted) return;
        const remote = activeProviders.flatMap((provider) => providerResults.get(provider.source) ?? []);
        deps.publish({
          query,
          generation: mine,
          items: rankUniversalItems(query, [...local, ...remote], deps.limits),
          pending: activeProviders
            .map((provider) => provider.source)
            .filter((source) => pending.has(source)),
          failures: [...failures],
        });
      };

      publish();
      await Promise.all(
        activeProviders.map(async (provider) => {
          try {
            const found = await provider.search(query.trim(), signal);
            if (mine !== generation || signal.aborted) return;
            providerResults.set(provider.source, found);
          } catch (error) {
            if (mine !== generation || signal.aborted) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            failures.push({ source: provider.source, message: failureMessage(provider.source) });
          } finally {
            if (mine === generation && !signal.aborted) {
              pending.delete(provider.source);
              publish();
            }
          }
        }),
      );
    },

    close(): void {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}
