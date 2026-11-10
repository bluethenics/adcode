/**
 * Putting a long list of skills in order - for the person, and for the assistant.
 *
 * Somebody with eighty skills from four tools cannot find the three they use, and neither
 * can the assistant: every enabled skill competes in its capability search. A skill therefore
 * has a rank the person sets:
 *
 *  - `pinned`: a favourite. Listed first in the Tools page, named to the assistant up front,
 *    and ahead of everything else in its search.
 *  - `normal`: found by search when its words match.
 *  - `low`: kept and enabled, but only offered when nothing better matches - for the skill
 *    that is occasionally right and usually in the way.
 *
 * Pure data, shared by the main-process search and the Tools page.
 */
export type SkillRank = "pinned" | "normal" | "low";
export type SkillSort = "smart" | "name" | "source" | "size" | "enabled";

export const SKILL_SORTS: readonly { readonly id: SkillSort; readonly label: string }[] = [
  { id: "smart", label: "Pinned first" },
  { id: "name", label: "Name" },
  { id: "source", label: "Where it came from" },
  { id: "size", label: "Smallest first" },
  { id: "enabled", label: "Enabled first" },
];

export const isSkillRank = (value: unknown): value is SkillRank => value === "pinned" || value === "normal" || value === "low";
export const isSkillSort = (value: unknown): value is SkillSort => SKILL_SORTS.some((sort) => sort.id === value);

export interface SortableSkill {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly estimatedTokens: number;
  readonly rank: SkillRank;
}

const RANK_ORDER: Readonly<Record<SkillRank, number>> = { pinned: 0, normal: 1, low: 2 };

/** A new list in the chosen order. Ties always fall back to the name, so the order is stable. */
export function sortSkills<T extends SortableSkill>(skills: readonly T[], sort: SkillSort): T[] {
  const byName = (a: T, b: T): number => a.name.localeCompare(b.name);
  const compare: Record<SkillSort, (a: T, b: T) => number> = {
    smart: (a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || Number(b.enabled) - Number(a.enabled) || byName(a, b),
    name: byName,
    source: (a, b) => a.source.localeCompare(b.source) || byName(a, b),
    size: (a, b) => a.estimatedTokens - b.estimatedTokens || byName(a, b),
    enabled: (a, b) => Number(b.enabled) - Number(a.enabled) || byName(a, b),
  };
  return [...skills].sort(compare[sort]);
}

/** The places skills came from, with how many each brought, most first. */
export function skillSources(skills: readonly SortableSkill[]): { readonly source: string; readonly count: number; readonly enabled: number }[] {
  const out = new Map<string, { count: number; enabled: number }>();
  for (const skill of skills) {
    const entry = out.get(skill.source) ?? { count: 0, enabled: 0 };
    entry.count += 1;
    if (skill.enabled) entry.enabled += 1;
    out.set(skill.source, entry);
  }
  return [...out].map(([source, value]) => ({ source, ...value })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/**
 * A search score adjusted for rank. A pinned skill that matches at all goes ahead of any
 * unpinned one; a low skill goes behind every other match, and is dropped when `others`
 * better matches exist - which is what keeps it out of the assistant's way.
 */
export function rankedSkillScore(score: number, rank: SkillRank): number {
  if (score <= 0) return 0;
  return rank === "pinned" ? score + 100 : rank === "low" ? score / 100 : score;
}
