import { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Link, Hr, render } from "react-email";
import type { StatusAlertJob } from "@adcode/api/src/statusAlerts.ts";

/**
 * The status page's own emails, from noreply@bluethenics.com: the one confirmation an address
 * gets before it is on a list, and the alerts after - a model degraded, failing, or back to
 * normal, and incident updates. The same quiet card as Announcement.tsx, with a coloured state
 * line so the news reads before the words do. Nobody needs an account for any of it.
 */
const font = "Arial, Helvetica, sans-serif";
const paragraph = { fontFamily: font, fontSize: "16px", lineHeight: "27px", color: "#56534e" };
const footnote = { ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px", color: "#666159" };

/** Each state's word and colour, on the dark header. Green is only ever the all-clear. */
const STATES: Record<string, { word: string; color: string }> = {
  operational: { word: "Back to normal", color: "#5fd39a" },
  degraded: { word: "Degraded performance", color: "#f2c055" },
  outage: { word: "Outage", color: "#ff7a6b" },
  investigating: { word: "Incident · Investigating", color: "#f2c055" },
  identified: { word: "Incident · Cause found", color: "#f2c055" },
  monitoring: { word: "Incident · Fix in place, watching", color: "#8fb6ff" },
  resolved: { word: "Incident · Resolved", color: "#5fd39a" },
};

function tracked(url: string, campaign: string): string {
  const target = new URL(url);
  target.searchParams.set("utm_source", "resend");
  target.searchParams.set("utm_medium", "email");
  target.searchParams.set("utm_campaign", campaign);
  return target.href;
}

function Card({ preview, eyebrow, eyebrowColor, title, children, footer }: {
  preview: string; eyebrow: string; eyebrowColor: string; title: string; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: font }}>
        <Preview>{preview.slice(0, 140)}</Preview>
        <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
          <Section style={{ padding: "32px 24px 20px" }}>
            <Text style={{ fontFamily: font, fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.8px", color: "#25241f", margin: "0" }}>adcode<span style={{ color: "#81775e" }}>.</span> <span style={{ fontWeight: 400, color: "#81775e", letterSpacing: "0" }}>status</span></Text>
          </Section>
          <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px", overflow: "hidden" }}>
            <Section style={{ backgroundColor: "#24231f", padding: "30px 28px" }}>
              <Text style={{ fontFamily: font, fontSize: "11px", lineHeight: "18px", letterSpacing: "2px", color: eyebrowColor, textTransform: "uppercase", fontWeight: 700, margin: "0 0 14px" }}>● {eyebrow}</Text>
              <Heading style={{ fontFamily: font, fontSize: "28px", lineHeight: "35px", fontWeight: 600, letterSpacing: "-0.8px", color: "#f5f1e7", margin: "0", maxWidth: "470px" }}>{title}</Heading>
            </Section>
            <Section style={{ padding: "28px" }}>{children}</Section>
          </Section>
          <Section style={{ padding: "24px 24px 36px" }}>
            <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
            {footer}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const button = { backgroundColor: "#292820", border: "1px solid #292820", borderRadius: "8px", color: "#fcfbf7", fontFamily: font, fontSize: "15px", lineHeight: "22px", fontWeight: 600, textAlign: "center" as const, textDecoration: "none", padding: "14px 24px", boxSizing: "border-box" as const };

function alertCopy(job: StatusAlertJob) {
  const state = STATES[job.payload.status] ?? { word: "Status update", color: "#cec7b5" };
  const why = job.topic === "models"
    ? "You asked the ADCode status page to email you when an included AI model has trouble and when it recovers."
    : "You asked the ADCode status page to email you about incident updates.";
  return { state, why, action: "Open the status page" };
}

export function StatusAlertEmail({ job, unsubscribeUrl, postalAddress }: { job: StatusAlertJob; unsubscribeUrl: string; postalAddress: string }) {
  const copy = alertCopy(job);
  return (
    <Card
      preview={job.payload.summary}
      eyebrow={copy.state.word}
      eyebrowColor={copy.state.color}
      title={job.payload.title}
      footer={<>
        <Text style={footnote}>{copy.why} Sent from an address that does not read replies.</Text>
        <Text style={footnote}>ADCode by Bluethenics<br />{postalAddress}</Text>
        <Link href={unsubscribeUrl} style={{ fontFamily: font, fontSize: "12px", lineHeight: "24px", color: "#4c493e", textDecoration: "underline" }}>Stop status emails</Link>
      </>}
    >
      <Text style={{ ...paragraph, margin: "0 0 24px" }}>{job.payload.summary}</Text>
      <Button href={tracked(job.payload.url, `adcode-status-${job.topic}`)} style={button}>{copy.action} &rarr;</Button>
    </Card>
  );
}

export async function renderStatusAlert(job: StatusAlertJob, unsubscribeUrl: string, postalAddress: string) {
  const copy = alertCopy(job);
  const html = await render(<StatusAlertEmail job={job} unsubscribeUrl={unsubscribeUrl} postalAddress={postalAddress} />);
  const text = [
    copy.state.word, job.payload.title, job.payload.summary,
    copy.action + ": " + tracked(job.payload.url, `adcode-status-${job.topic}`),
    copy.why, "ADCode by Bluethenics", postalAddress, "Stop status emails: " + unsubscribeUrl,
  ].join("\n\n");
  return { subject: job.subject, html, text };
}

function lists(models: boolean, incidents: boolean): string {
  if (models && incidents) return "when an included AI model degrades or fails, when it is back to normal, and about incident updates";
  return models ? "when an included AI model degrades or fails, and when it is back to normal" : "about incident updates";
}

export function StatusConfirmEmail({ confirmUrl, models, incidents, postalAddress }: { confirmUrl: string; models: boolean; incidents: boolean; postalAddress: string | null }) {
  return (
    <Card
      preview="One click and you will hear the moment a model has trouble."
      eyebrow="Confirm your email"
      eyebrowColor="#cec7b5"
      title="Confirm your status alerts"
      footer={<>
        <Text style={footnote}>Someone - hopefully you - entered this address on the ADCode status page. If it was not you, ignore this email: without a click, nothing else is ever sent. The link works for seven days.</Text>
        {postalAddress !== null && <Text style={footnote}>ADCode by Bluethenics<br />{postalAddress}</Text>}
      </>}
    >
      <Text style={{ ...paragraph, margin: "0 0 24px" }}>{`Confirm, and ADCode will email you ${lists(models, incidents)}. Every alert has a one-click unsubscribe.`}</Text>
      <Button href={confirmUrl} style={button}>Confirm my alerts &rarr;</Button>
    </Card>
  );
}

export async function renderStatusConfirm(input: { confirmUrl: string; models: boolean; incidents: boolean; postalAddress: string | null }) {
  const html = await render(<StatusConfirmEmail {...input} />);
  const text = [
    "Confirm your status alerts",
    `Confirm, and ADCode will email you ${lists(input.models, input.incidents)}. Every alert has a one-click unsubscribe.`,
    "Confirm: " + input.confirmUrl,
    "Someone entered this address on the ADCode status page. If it was not you, ignore this email: without a click, nothing else is ever sent.",
    ...(input.postalAddress === null ? [] : ["ADCode by Bluethenics", input.postalAddress]),
  ].join("\n\n");
  return { subject: "Confirm your ADCode status alerts", html, text };
}
