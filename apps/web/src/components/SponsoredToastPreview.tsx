/**
 * The sponsored card, exactly as the desktop editor renders it.
 *
 * Same DOM order, same grid, same measurements as
 * `apps/desktop/src/renderer/notifications/notifications.ts` (`showSponsored`) with
 * `apps/desktop/src/renderer/styles/notifications.css`: a 32px logo slot, the content
 * column with its "Sponsored" pill and `{advertiser} — {headline}` title, and the
 * dismiss control. The styles live beside it as `.toast-desktop*` in `globals.css`,
 * using the desktop dark-theme tokens verbatim so the portal preview and the real
 * toast cannot drift apart without it being visible here first.
 *
 * The dismiss control is inert decoration - it shows where the button sits without
 * stealing clicks from the form around it.
 */
export function SponsoredToastPreview({
  brand,
  headline,
  body,
  logo,
}: {
  brand: string;
  headline: string;
  body: string;
  logo: string | null;
}) {
  const name = brand.trim() || "Your brand";
  const title = `${name} — ${headline.trim() || "Your message"}`;

  return (
    <article className="toast-desktop toast-desktop-sponsored" aria-label={`Sponsored message from ${name}`}>
      <div className="toast-desktop-logo" aria-hidden={logo !== null}>
        {logo !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL at its
          // rendered size; next/image would proxy it for nothing.
          <img src={logo} alt="" width={32} height={32} />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </div>
      <div className="toast-desktop-content">
        <span className="toast-desktop-label">Sponsored</span>
        <p className="toast-desktop-title">{title}</p>
        {body.trim().length > 0 && <p className="toast-desktop-body">{body}</p>}
      </div>
      <span className="toast-desktop-close" aria-hidden="true">
        <svg viewBox="0 0 10 10">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </span>
    </article>
  );
}
