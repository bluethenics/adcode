import { useId } from "react";

/**
 * The ADCode mark, `<$>`, as a folded ribbon.
 *
 * The same geometry as `apps/desktop/src/renderer/workbench/brandMark.ts`,
 * `build/icon.svg`, `apps/web/src/app/icon.svg`, the OAuth result page in
 * `apps/desktop/src/main/oauth.ts`, and the art in
 * `apps/web/src/app/opengraph-image.source.html` - path for path, fold for
 * fold. A logo that differs between the site and the app is two logos.
 *
 * The centre-lines never changed, only the weight: chunky rounded strokes with
 * a dark fold at each bracket tip, a diagonal twist where each dollar stem
 * meets the S, and a soft shadow where the S crosses over itself. The folds
 * are plain black at low opacity over `currentColor`, so the mark stays one
 * colour that inverts with the theme instead of carrying a palette of its own.
 */
export function Mark({ size = 20, accent = false }: { size?: number; accent?: boolean }) {
  const bracket = accent ? "var(--accent)" : "currentColor";
  const foldId = `adcode-fold-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

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
      <defs>
        <linearGradient id={foldId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".38" />
          <stop offset=".55" stopColor="#000" stopOpacity=".14" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* The ribbon body. Same centre-lines as ever, cut thicker. */}
      <path d="M320 348L140 512L320 676" stroke={bracket} strokeWidth={96} />
      <path d="M704 348L884 512L704 676" stroke={bracket} strokeWidth={96} />
      {/* The dollar's stem, in two strokes, so the S is not crossed through the middle. */}
      <path d="M512 296V388" stroke="currentColor" strokeWidth={64} />
      <path d="M512 636V728" stroke="currentColor" strokeWidth={64} />
      <path d="M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619" stroke="currentColor" strokeWidth={92} />
      {/* Fold at each bracket tip: the side face of the ribbon turning the corner. */}
      <path d="M128 478L128 546L198 512Z" fill={`url(#${foldId})`} stroke="none" />
      <path d="M896 478L896 546L826 512Z" fill={`url(#${foldId})`} stroke="none" />
      {/* Sheen along the outer top edges, shade along the outer bottom edges. */}
      <path d="M292 358L164 474" stroke="#fff" strokeWidth={20} opacity={.26} />
      <path d="M732 358L860 474" stroke="#fff" strokeWidth={20} opacity={.26} />
      <path d="M164 550L292 666" stroke="#000" strokeWidth={20} opacity={.2} />
      <path d="M860 550L732 666" stroke="#000" strokeWidth={20} opacity={.2} />
      {/* Twists where each stem dives behind the S, cut on the diagonal. */}
      <path d="M480 340L544 340L522 394L498 394Z" fill="#000" opacity={.3} stroke="none" />
      <path d="M480 630L544 630L522 684L498 684Z" fill="#000" opacity={.3} stroke="none" />
      {/* Shadow where the S crosses over itself. */}
      <path d="M492 512Q560 536 512 576" stroke="#000" strokeWidth={32} opacity={.22} />
      {/* Sheen on the upper loop of the S. */}
      <path d="M440 400Q450 375 490 368" stroke="#fff" strokeWidth={15} opacity={.24} />
    </svg>
  );
}
