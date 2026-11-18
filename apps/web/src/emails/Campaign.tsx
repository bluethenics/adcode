import { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Link, Hr, render } from "react-email";
import { personalize, type CampaignInput } from "@adcode/api/src/adminConsole.ts";

/**
 * An administrator-written campaign (Admin > Email campaigns), in the house style of the return
 * emails: the wordmark, a dark title band, the message, one button, and a footer with the postal
 * address and a one-click unsubscribe. The words are the administrator's; the frame is fixed.
 */
const font = "Arial, Helvetica, sans-serif";
const paragraph = { fontFamily: font, fontSize: "16px", lineHeight: "27px", color: "#56534e" };
const small = { ...paragraph, fontSize: "12px", lineHeight: "20px", color: "#666159" };

type Content = Pick<CampaignInput, "name" | "subject" | "preheader" | "heading" | "body" | "ctaLabel" | "ctaUrl">;

/** The button's address with this campaign's tracking, so the website's analytics can attribute visits. */
export function campaignLink(campaign: Content): string | null {
  if (campaign.ctaUrl === null) return null;
  const target = new URL(campaign.ctaUrl);
  target.searchParams.set("utm_source", "resend");
  target.searchParams.set("utm_medium", "email");
  target.searchParams.set("utm_campaign", campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "admin-campaign");
  return target.href;
}

/** Blank lines separate paragraphs; single line breaks stay line breaks. */
export function paragraphs(body: string): string[][] {
  return body.split(/\n\s*\n/).map((block) => block.split("\n").map((line) => line.trim())).filter((block) => block.some((line) => line.length > 0));
}

export function CampaignEmail({ campaign, displayName, unsubscribeUrl, postalAddress }: { campaign: Content; displayName: string | null; unsubscribeUrl: string; postalAddress: string }) {
  const link = campaignLink(campaign);
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: font }}>
        {campaign.preheader.length > 0 && <Preview>{personalize(campaign.preheader, displayName)}</Preview>}
        <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
          <Section style={{ padding: "32px 24px 20px" }}>
            <Text style={{ fontFamily: font, fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.8px", color: "#25241f", margin: "0" }}>adcode<span style={{ color: "#81775e" }}>.</span></Text>
          </Section>
          <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px", overflow: "hidden" }}>
            <Section style={{ backgroundColor: "#24231f", padding: "38px 28px" }}>
              <Heading style={{ fontFamily: font, fontSize: "32px", lineHeight: "39px", fontWeight: 600, letterSpacing: "-1.2px", color: "#f5f1e7", margin: "0", maxWidth: "460px" }}>{personalize(campaign.heading, displayName)}</Heading>
            </Section>
            <Section style={{ padding: "28px" }}>
              {paragraphs(personalize(campaign.body, displayName)).map((lines, index) => (
                <Text key={index} style={{ ...paragraph, margin: "0 0 18px" }}>
                  {lines.map((line, at) => <span key={at}>{at > 0 && <br />}{line}</span>)}
                </Text>
              ))}
              {link !== null && campaign.ctaLabel !== null && (
                <Button href={link} style={{ backgroundColor: "#292820", border: "1px solid #292820", borderRadius: "8px", color: "#fcfbf7", fontFamily: font, fontSize: "15px", lineHeight: "22px", fontWeight: 600, textAlign: "center", textDecoration: "none", padding: "14px 24px", boxSizing: "border-box", marginTop: "8px" }}>{campaign.ctaLabel} &rarr;</Button>
              )}
            </Section>
          </Section>
          <Section style={{ padding: "24px 24px 36px" }}>
            <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
            <Text style={{ ...small, margin: "0 0 8px" }}>You&apos;re receiving this because you have an ADCode account. One click below and we won&apos;t email you updates again.</Text>
            <Text style={{ ...small, margin: "0 0 8px" }}>ADCode by Bluethenics<br />{postalAddress}</Text>
            <Link href={unsubscribeUrl} style={{ fontFamily: font, fontSize: "12px", lineHeight: "24px", color: "#4c493e", textDecoration: "underline" }}>Unsubscribe</Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderCampaign(campaign: Content, recipient: { displayName: string | null }, unsubscribeUrl: string, postalAddress: string) {
  const html = await render(<CampaignEmail campaign={campaign} displayName={recipient.displayName} unsubscribeUrl={unsubscribeUrl} postalAddress={postalAddress} />);
  const link = campaignLink(campaign);
  const text = [
    personalize(campaign.heading, recipient.displayName),
    ...paragraphs(personalize(campaign.body, recipient.displayName)).map((lines) => lines.join("\n")),
    ...(link !== null && campaign.ctaLabel !== null ? [campaign.ctaLabel + ": " + link] : []),
    "ADCode by Bluethenics", postalAddress,
    "You're receiving this because you have an ADCode account.",
    "Unsubscribe: " + unsubscribeUrl,
  ].join("\n\n");
  return { subject: personalize(campaign.subject, recipient.displayName), html, text };
}
