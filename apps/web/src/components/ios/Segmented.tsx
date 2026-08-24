"use client";

/**
 * The iOS segmented control.
 *
 * A row of choices where exactly one is on, with the selection drawn as a sliding pill
 * rather than a highlighted label. Used where a page has three or four views of the same
 * data - which is a switch, not navigation, and so should not be a set of links that
 * reload anything.
 *
 * Built on real radio semantics rather than buttons and `aria-selected`: a screen reader
 * then announces "2 of 4" without being told, and arrow keys work because they are what
 * radios do.
 */
export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{ ["--count" as string]: options.length, ["--index" as string]: index }}
    >
      {/* The pill is one element that slides, not a class on the active label: moving one
          box reads as a control, and repainting four backgrounds reads as a flicker. */}
      <span className="segmented-pill" aria-hidden="true" />

      {options.map((option) => (
        <label key={option.value} className="segmented-option">
          <input
            type="radio"
            name={label}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
