"use client";

import { useMemo, useState } from "react";
import { X } from "lucide";
import { Icon } from "@/components/Icon";
import { COUNTRY_CODES, MAX_REGIONS, REGION_GROUPS } from "@adcode/api/src/regions.ts";

/** "Germany" for "DE", in English; the code itself if the browser cannot say. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Countries for a campaign: region shortcuts that select their countries in one click, a
 * search over every country, and what is selected as removable chips. Only countries are
 * stored (as `geo:XX` target tags), so the shortcuts are a convenience, not a contract.
 */
export function RegionPicker({ selected, onChange }: { selected: readonly string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");
  const chosen = useMemo(() => new Set(selected), [selected]);
  const all = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const q = query.trim().toLowerCase();
  const matches = q.length === 0 ? [] : all.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q).slice(0, 8);
  const full = selected.length >= MAX_REGIONS;

  const set = (codes: Iterable<string>) => onChange([...new Set(codes)].slice(0, MAX_REGIONS));
  const toggleGroup = (countries: readonly string[]) => {
    const on = countries.every((code) => chosen.has(code));
    set(on ? selected.filter((code) => !countries.includes(code)) : [...selected, ...countries]);
  };

  return (
    <div className="ap-regions">
      <div className="ap-region-groups" role="group" aria-label="Region shortcuts">
        {REGION_GROUPS.map((group) => {
          const on = group.countries.every((code) => chosen.has(code));
          return (
            <button key={group.id} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggleGroup(group.countries)}>
              {group.label}
            </button>
          );
        })}
      </div>

      <div className="field ap-region-search">
        <label htmlFor="ap-region-q">Add a country</label>
        <input
          id="ap-region-q"
          className="input"
          autoComplete="off"
          placeholder="Search, for example Brazil"
          value={query}
          disabled={full}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0] !== undefined) {
              event.preventDefault();
              set([...selected, matches[0].code]);
              setQuery("");
            }
          }}
        />
        {matches.length > 0 && (
          <ul className="ap-region-matches" role="listbox" aria-label="Matching countries">
            {matches.map((country) => (
              <li key={country.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={chosen.has(country.code)}
                  onClick={() => {
                    set(chosen.has(country.code) ? selected.filter((code) => code !== country.code) : [...selected, country.code]);
                    setQuery("");
                  }}
                >
                  {country.name}
                  <small>{chosen.has(country.code) ? "Selected" : country.code}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.length > 0 && matches.length === 0 && <span className="field-hint">No country matches that.</span>}
      </div>

      {selected.length > 0 && (
        <div className="ap-region-chosen">
          <span className="field-hint">{selected.length} of up to {MAX_REGIONS} countries</span>
          <ul>
            {selected.map((code) => (
              <li key={code}>
                {countryName(code)}
                <button type="button" aria-label={`Remove ${countryName(code)}`} onClick={() => set(selected.filter((one) => one !== code))}>
                  <Icon node={X} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ap-link ap-link-quiet" onClick={() => onChange([])}>Clear all</button>
        </div>
      )}
    </div>
  );
}

/** "Germany, France" or "Germany and 11 more": a review line, not a list. */
export function regionSummary(codes: readonly string[]): string {
  if (codes.length === 0) return "Worldwide";
  if (codes.length <= 2) return codes.map(countryName).join(", ");
  return `${countryName(codes[0] ?? "")} and ${codes.length - 1} more`;
}
