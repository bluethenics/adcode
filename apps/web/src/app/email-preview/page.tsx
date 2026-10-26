import type { Metadata } from "next";
import { renderReengagement } from "@/emails/Reengagement";
import { renderStatusAlert, renderStatusConfirm } from "@/emails/StatusAlert";
import type { StatusAlertJob } from "@adcode/api/src/statusAlerts.ts";

export const metadata: Metadata = { title: "ADCode email previews", robots: { index: false, follow: false } };

const POSTAL = "Postal address required before sending";
const UNSUBSCRIBE = "https://adcode.bluethenics.com/v1/status/unsubscribe?token=00000000-0000-4000-8000-000000000000";
const alert = (status: string, title: string, summary: string, subject: string): StatusAlertJob => ({
  id: "preview", email: "you@example.com", attempts: 0, topic: "models", subject, manageToken: "00000000-0000-4000-8000-000000000000",
  payload: { title, summary, status, url: "https://adcode.bluethenics.com/status#models" },
});

function Grid({ mails }: { mails: { subject: string; html: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 20, marginTop: 32 }}>
      {mails.map((mail, index) => <section key={mail.subject} style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, marginBottom: 12 }}>Email {index + 1} · {mail.subject}</p>
        <iframe title={"Email " + (index + 1) + " preview"} srcDoc={mail.html} sandbox="" style={{ width: "100%", height: 1050, border: "1px solid var(--border)", borderRadius: 12, background: "#f1efea" }} />
      </section>)}
    </div>
  );
}

export default async function EmailPreview() {
  const previews = await Promise.all(([0, 1, 2] as const).map((step) =>
    renderReengagement(step, "https://adcode.bluethenics.com/dashboard#email-preferences", POSTAL)));
  const status = await Promise.all([
    renderStatusConfirm({ confirmUrl: "https://adcode.bluethenics.com/status/subscription?confirm=00000000-0000-4000-8000-000000000000", models: true, incidents: true, postalAddress: POSTAL }),
    renderStatusAlert(alert("degraded", "Qwen 3.8 is having trouble", "12% of the last 240 requests to Qwen 3.8 failed on our side - more than usual. Most still work; if a chat fails, send it again or switch models. We will email you when it is back to normal.", "Degraded: Qwen 3.8 has elevated errors"), UNSUBSCRIBE, POSTAL),
    renderStatusAlert(alert("operational", "Qwen 3.8 is back to normal", "Requests to Qwen 3.8 are answering normally again - 0.4% failed in the latest check. Nothing to do on your side; chats that failed can simply be sent again.", "Resolved: Qwen 3.8 is back to normal"), UNSUBSCRIBE, POSTAL),
  ]);
  return (
    <main style={{ maxWidth: 1220, margin: "0 auto", padding: "48px 20px" }}>
      <p className="eyebrow">ADCode mail</p>
      <h1 style={{ fontSize: "clamp(30px, 5vw, 48px)", margin: "12px 0" }}>A thoughtful way back.</h1>
      <p style={{ maxWidth: 650, color: "var(--muted)", lineHeight: 1.7 }}>Starts after 14 days away, with follow-ups 4 and 10 days later. Sending is disabled. Only verified users who opt in are eligible.</p>
      <Grid mails={previews} />
      <h2 style={{ fontSize: "clamp(24px, 4vw, 34px)", margin: "64px 0 12px" }}>Status alerts</h2>
      <p style={{ maxWidth: 650, color: "var(--muted)", lineHeight: 1.7 }}>From noreply@bluethenics.com to anyone who confirmed on /status: the confirmation, a model degrading, and the all-clear.</p>
      <Grid mails={status} />
    </main>
  );
}
