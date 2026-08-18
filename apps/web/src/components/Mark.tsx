/**
 * The ADCode mark, `<$>`.
 *
 * The same geometry as `apps/desktop/src/renderer/workbench/brandMark.ts` and
 * `build/icon.svg`, path for path. A logo that differs between the site and the app is
 * two logos.
 */
export function Mark({ size = 20, accent = false }: { size?: number; accent?: boolean }) {
  const bracket = accent ? "var(--accent)" : "currentColor";

  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      role="img"
      aria-label="ADCode"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M92 76 L52 128 L92 180" stroke={bracket} strokeWidth={19} />
      <path d="M164 76 L204 128 L164 180" stroke={bracket} strokeWidth={19} />
      <path d="M128 62 L128 194" stroke="currentColor" strokeWidth={13} />
      <path
        d="M148 98 C148 85 139 79 128 79 C117 79 108 86 108 97 C108 108 118 113 128 117 C138 121 148 127 148 138 C148 150 138 157 128 157 C117 157 108 151 108 138"
        stroke="currentColor"
        strokeWidth={15}
      />
    </svg>
  );
}
