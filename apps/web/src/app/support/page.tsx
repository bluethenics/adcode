import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { SupportForm } from "@/components/SupportForm";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Support",
  description: "Send a secure support message to the ADCode team, or cancel a subscription yourself in two clicks.",
  alternates: { canonical: url("/support") },
  robots: { index: false, follow: false },
};

/*
 * Cancelling comes first on this page because it is what most support messages asked for:
 * of the help requests in November 2026, the largest group was people paying for a plan who
 * could not find how to stop it renewing - two of them writing in Russian.
 */
export default function SupportPage() {
  return (
    <AppShell title="Support" subtitle="One message, sent directly to the ADCode team.">
      <section className="support-cancel" aria-labelledby="support-cancel-heading" id="cancel">
        <h2 id="support-cancel-heading">Cancel or change a subscription</h2>
        <ol>
          <li>Sign in at <a href="/ai-tokens#manage">AI plans</a> with the account you paid with.</li>
          <li>Press <strong>Manage or cancel subscription</strong>. Your billing portal opens.</li>
          <li>Choose <strong>Cancel subscription</strong>. Nothing renews after that, and your plan keeps working until the end of the period you paid for.</li>
        </ol>
        <p>In the desktop app: the account button in the top right, then <strong>Manage or cancel plan</strong>.</p>
        <p lang="ru">Отменить подписку: войдите на странице <a href="/ai-tokens#manage">AI plans</a> тем же аккаунтом, нажмите <strong>Manage or cancel subscription</strong> и выберите <strong>Cancel subscription</strong>. Списаний больше не будет, а план работает до конца оплаченного периода.</p>
        <p>Still stuck? Send the message below and we will cancel it for you.</p>
      </section>
      <SupportForm />
    </AppShell>
  );
}
