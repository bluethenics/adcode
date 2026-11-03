import { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Link, Hr, render } from "react-email";

export interface AdvertiserWelcomeProps { name: string; portalUrl: string; postalAddress: string }
export const ADVERTISER_WELCOME_SUBJECT = "Welcome to ADCode advertising — let’s get your campaign ready";
const paragraph = { fontFamily: "Arial, Helvetica, sans-serif", fontSize: "16px", lineHeight: "27px", color: "#56534e" };
export function AdvertiserWelcomeEmail({ name, portalUrl, postalAddress }: AdvertiserWelcomeProps) {
  return <Html lang="en"><Head /><Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: paragraph.fontFamily }}>
    <Preview>Your advertiser workspace is ready. A clear path to your first campaign, with help when you need it.</Preview>
    <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
      <Section style={{ padding: "32px 24px 20px" }}><Text style={{ color: "#25241f", fontSize: "20px", fontWeight: 700, margin: "0" }}>adcode.</Text></Section>
      <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px" }}>
        <Section style={{ backgroundColor: "#24231f", padding: "32px 28px", borderRadius: "16px 16px 0 0" }}>
          <Text style={{ color: "#cec7b5", fontSize: "11px", letterSpacing: "2px", margin: "0 0 14px", textTransform: "uppercase" }}>Your advertiser workspace</Text>
          <Heading as="h1" style={{ color: "#f5f1e7", fontSize: "32px", lineHeight: "39px", fontWeight: 600, margin: "0" }}>Welcome, {name}.</Heading>
        </Section>
        <Section style={{ padding: "28px" }}>
          <Text style={{ ...paragraph, margin: "0 0 20px" }}>Thank you for creating an advertiser workspace with ADCode. You can now manage your campaigns, account balance, and results in one place.</Text>
          <Heading as="h2" style={{ color: "#292820", fontSize: "20px", lineHeight: "28px", margin: "0 0 16px" }}>A practical first launch</Heading>
          <Text style={paragraph}><strong>1. Make one clear offer.</strong> Use a concise headline, a recognizable logo, and a landing page that matches your message. Choose the developer interests that fit your product.</Text>
          <Text style={paragraph}><strong>2. Start with a budget you control.</strong> Choose a small test budget you are comfortable with. Review your bid and campaign limit, then add only the credit you intend to use.</Text>
          <Text style={paragraph}><strong>3. Publish your card, then review the results.</strong> A card goes live as soon as it passes the automated checks on submit, provided the campaign has enough available credit. Use the portal’s views, clicks, and spend to assess the test. Adjust your message before increasing the budget.</Text>
          <Button href={portalUrl} style={{ backgroundColor: "#292820", border: "1px solid #292820", borderRadius: "8px", color: "#fcfbf7", fontSize: "15px", fontWeight: 600, lineHeight: "22px", padding: "14px 24px", textDecoration: "none", boxSizing: "border-box", textAlign: "center" }}>Open your advertiser workspace →</Button>
          <Text style={{ ...paragraph, margin: "24px 0 0" }}><strong>Would a second pair of eyes help?</strong> Reply with what you are promoting, the audience you want to reach, and the test budget you have in mind. We can help you work through campaign setup or a launch issue.</Text>
          <Text style={{ ...paragraph, fontSize: "14px", lineHeight: "23px" }}>Already started a campaign? Your workspace shows its current status and the next steps. Results depend on your campaign and available ad inventory; views, clicks, and sales are not guaranteed.</Text>
        </Section>
      </Section>
      <Section style={{ padding: "24px 24px 36px" }}>
        <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
        <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px" }}>This one-time setup email was sent because an advertiser workspace was created for this account. It does not subscribe you to marketing emails.</Text>
        <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px" }}>ADCode by Bluethenics<br />{postalAddress}</Text>
        <Link href="mailto:adcode@bluethenics.com" style={{ color: "#4c493e", fontSize: "12px", lineHeight: "24px" }}>Contact advertiser support</Link>
      </Section>
    </Container>
  </Body></Html>;
}
AdvertiserWelcomeEmail.PreviewProps = { name: "Your brand", portalUrl: "https://adcode.bluethenics.com/portal", postalAddress: "ADCode mailing address" } satisfies AdvertiserWelcomeProps;

export async function renderAdvertiserWelcome(name: string, portalUrl: string, postalAddress: string) {
  const component = <AdvertiserWelcomeEmail name={name} portalUrl={portalUrl} postalAddress={postalAddress} />;
  const [html, text] = await Promise.all([render(component), render(component, { plainText: true })]);
  return { subject: ADVERTISER_WELCOME_SUBJECT, html, text };
}
