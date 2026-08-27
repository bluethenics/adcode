export function AdPreviewMark({ logo, company }: { logo: string | null; company: string }) {
  const name = company.trim() || "Advertiser";

  if (logo !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a local data URL produced by LogoDrop.
      <img src={logo} alt={`${name} logo`} className="bid-preview-logo" width={34} height={34} />
    );
  }

  return <i className="bid-preview-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</i>;
}
