"use client";

/**
 * Targeting, from the closed 45-tag vocabulary.
 *
 * Checkboxes rather than free text, because the vocabulary is fixed and the server drops
 * anything outside it. A text field would let someone type `lang:cobol`, submit happily,
 * and never understand why nobody saw their ad.
 *
 * Grouped by prefix, because "languages / frameworks / tools / platforms" is how the
 * person choosing actually thinks about it.
 */
const TAGS = [
  "lang:c", "lang:cpp", "lang:csharp", "lang:css", "lang:go", "lang:html",
  "lang:java", "lang:javascript", "lang:json", "lang:kotlin", "lang:lua",
  "lang:markdown", "lang:php", "lang:python", "lang:ruby", "lang:rust",
  "lang:shell", "lang:sql", "lang:swift", "lang:typescript", "lang:yaml",
  "fw:angular", "fw:django", "fw:express", "fw:laravel", "fw:next",
  "fw:nuxt", "fw:rails", "fw:react", "fw:spring", "fw:svelte", "fw:vue",
  "tool:cargo", "tool:docker", "tool:gradle", "tool:kubernetes", "tool:maven",
  "tool:npm", "tool:terraform", "tool:vite", "tool:webpack",
  "platform:backend", "platform:desktop", "platform:mobile", "platform:web",
] as const;

const GROUPS: readonly { prefix: string; label: string }[] = [
  { prefix: "lang:", label: "Languages" },
  { prefix: "fw:", label: "Frameworks" },
  { prefix: "tool:", label: "Tools" },
  { prefix: "platform:", label: "Platforms" },
];

export function TagPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (tag: string) => {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  };

  return (
    <>
      <p className="field-hint">
        {selected.length === 0
          ? "Nothing selected — your ad reaches everyone. That's a valid choice, not an error."
          : `${selected.length} selected. Your ad reaches developers with any of these open.`}
      </p>

      {GROUPS.map((group) => (
        <div key={group.prefix} style={{ marginTop: 12 }}>
          <span className="stat-label">{group.label}</span>
          <div className="tag-grid" style={{ maxHeight: "none", marginTop: 6 }}>
            {TAGS.filter((tag) => tag.startsWith(group.prefix)).map((tag) => (
              <label key={tag} className="tag-check">
                <input
                  type="checkbox"
                  checked={selected.includes(tag)}
                  onChange={() => toggle(tag)}
                />
                {tag.slice(group.prefix.length)}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
