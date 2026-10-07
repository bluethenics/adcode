import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InvitePage from "../src/app/invite/page";
import { InviteHero } from "../src/app/i/[code]/InviteHero";

describe("/invite", () => {
  const html = renderToStaticMarkup(<InvitePage />);

  it("states the published terms in plain words", () => {
    for (const fact of ["10% of what ADCode earns", "5% of what they spend", "365 days", "14 days", "keep every cent of theirs"]) {
      expect(html).toContain(fact);
    }
  });

  it("links to the full terms and the privacy policy", () => {
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });
});

describe("an invite link's hero, before the lookup answers", () => {
  it("is the ordinary hero: a dead or slow link still sells ADCode", () => {
    const html = renderToStaticMarkup(<InviteHero code="k7p4qzm" />);
    expect(html).toContain("The free AI code editor");
    expect(html).not.toContain("invited you");
    expect(html).not.toContain("Your invite code");
  });

  it("renders with no code at all", () => {
    expect(renderToStaticMarkup(<InviteHero code={null} />)).toContain("The free AI code editor");
  });
});
