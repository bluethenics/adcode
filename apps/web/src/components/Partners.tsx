import { PARTNERS, type Partner } from "@/lib/partners";

function PartnerMark({ partner }: { partner: Partner }) {
  const { logo, logoDark } = partner;
  if (logo === undefined) return null;
  // The name is printed beside the mark, so the image itself is decoration to a screen reader.
  return <>
    <img className={logoDark === undefined ? "partner-logo" : "partner-logo partner-logo-light"} src={logo.src} alt="" width={logo.width} height={logo.height} loading="lazy" decoding="async" />
    {logoDark === undefined ? null : <img className="partner-logo partner-logo-dark" src={logoDark.src} alt="" width={logoDark.width} height={logoDark.height} loading="lazy" decoding="async" />}
  </>;
}

/**
 * Partners, directly under the hero recording: who ADCode works with, each a link to them.
 * A quiet row rather than a section of its own - it vouches for the product above it, it is
 * not something to read.
 */
export function Partners() {
  if (PARTNERS.length === 0) return null;
  return <section className="partners" aria-labelledby="partners-heading">
    <h2 id="partners-heading" className="partners-heading">Partners</h2>
    <ul className="partners-list">
      {PARTNERS.map((partner) => <li key={partner.href}>
        <a className="partner" href={partner.href} target="_blank" rel="noreferrer">
          <PartnerMark partner={partner} />
          <span className="partner-name">{partner.name}</span>
        </a>
      </li>)}
    </ul>
  </section>;
}
