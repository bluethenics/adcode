/**
 * The admin panel's loading state.
 *
 * Every section used to say "Loading…" in body text, or show one grey block, so a page that
 * took a second looked broken rather than busy. This is one loader for all of them: the ADCode
 * mark with its two brackets breathing - the same mark as the rail, so it reads as ours - over
 * skeleton rows shaped like what is coming (a list, cards, or a form), with a light sweep across
 * them. Motion is transform and opacity only, and stops under reduced motion.
 */
import "./adminConsole.css";

type Shape = "list" | "cards" | "detail";

export function AdminLoader({ label = "Loading", shape = "list", rows = 5 }: { label?: string; shape?: Shape; rows?: number }) {
  return (
    <div className="adm-loader" role="status" aria-live="polite" data-shape={shape}>
      <div className="adm-loader-head">
        <LoaderMark />
        <span className="adm-loader-label">{label}<span className="adm-loader-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
      </div>
      <div className="adm-loader-body" aria-hidden="true">
        {shape === "cards" ? (
          <div className="adm-loader-cards">
            {Array.from({ length: Math.max(3, Math.min(rows, 6)) }, (_, index) => (
              <div key={index} className="adm-skel adm-skel-card" style={{ animationDelay: `${index * 70}ms` }}>
                <span className="adm-skel-bar" style={{ width: "38%" }} />
                <span className="adm-skel-bar adm-skel-big" style={{ width: "54%" }} />
                <span className="adm-skel-bar" style={{ width: "72%" }} />
              </div>
            ))}
          </div>
        ) : shape === "detail" ? (
          <div className="adm-loader-detail">
            <div className="adm-skel adm-skel-hero"><span className="adm-skel-dot" /><span className="adm-skel-bar adm-skel-big" style={{ width: "45%" }} /></div>
            <div className="adm-loader-cards">
              {[0, 1, 2, 3].map((index) => <div key={index} className="adm-skel adm-skel-card" style={{ animationDelay: `${index * 70}ms` }}><span className="adm-skel-bar" style={{ width: "40%" }} /><span className="adm-skel-bar adm-skel-big" style={{ width: "60%" }} /></div>)}
            </div>
          </div>
        ) : (
          <div className="adm-loader-rows">
            {Array.from({ length: rows }, (_, index) => (
              <div key={index} className="adm-skel adm-skel-row" style={{ animationDelay: `${index * 60}ms` }}>
                <span className="adm-skel-dot" />
                <span className="adm-skel-lines">
                  <span className="adm-skel-bar" style={{ width: `${48 + ((index * 17) % 30)}%` }} />
                  <span className="adm-skel-bar adm-skel-thin" style={{ width: `${26 + ((index * 11) % 20)}%` }} />
                </span>
                <span className="adm-skel-bar adm-skel-pill" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The mark alone, for a button or a single line ("Saving", "Sending a test"). */
export function LoaderMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="adm-loader-mark" viewBox="0 0 1024 1024" width={size} height={size} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="adm-loader-left" d="M320 348L140 512L320 676" stroke="currentColor" strokeWidth={96} />
      <path className="adm-loader-right" d="M704 348L884 512L704 676" stroke="currentColor" strokeWidth={96} />
      <path className="adm-loader-s" d="M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619" stroke="currentColor" strokeWidth={92} pathLength={1} />
    </svg>
  );
}
