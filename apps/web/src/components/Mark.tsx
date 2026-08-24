/**
 * The ADCode mark, `<$>`.
 *
 * The same geometry as `apps/desktop/src/renderer/workbench/brandMark.ts` and
 * `build/icon.svg`, path for path. A logo that differs between the site and the app is two
 * logos.
 */
export function Mark({ size = 20, accent = false }: { size?: number; accent?: boolean }) {
  const bracket = accent ? "var(--accent)" : "currentColor";

  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      role="img"
      aria-label="ADCode"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M320 348L140 512L320 676" stroke={bracket} strokeWidth={56} />
      <path d="M704 348L884 512L704 676" stroke={bracket} strokeWidth={56} />
      {/* The dollar's stem, in two strokes, so the S is not crossed through the middle. */}
      <path d="M512 322V365" stroke="currentColor" strokeWidth={42} />
      <path d="M512 662V702" stroke="currentColor" strokeWidth={42} />
      <path d="M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619" stroke="currentColor" strokeWidth={56} />
    </svg>
  );
}
