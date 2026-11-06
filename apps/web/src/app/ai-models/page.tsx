import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { ProviderModelsForm } from "./ProviderModelsForm";
import "../advertisers/advertisers.css";
import "../providers/providers.css";

export const metadata: Metadata = pageMetadata({
  path: "/ai-models",
  title: "AI models: submit your models to ADCode",
  socialTitle: "AI models in ADCode: submit yours",
  description: "AI model providers submit their OpenAI-compatible endpoint, key, limits and prices once. After an administrator tests and approves them, the models appear in every ADCode model picker, paid from developers' credits.",
});

const AFTER: readonly { title: string; body: string }[] = [
  { title: "We send each model one real request", body: "Using your key and endpoint, from ADCode's servers, so approval rests on an answer rather than a form." },
  { title: "An administrator approves or replies", body: "Approval registers your API as a provider and adds every model with the limits and prices you entered. If something needs changing, we email you." },
  { title: "Your models appear in the picker", body: "Every ADCode editor refreshes its model list within five minutes. Provider reports then show requests, errors and speed." },
];

const FAQ: readonly { q: string; a: string }[] = [
  { q: "How is my API key kept?", a: "It is encrypted on arrival and bound to your submission, never shown to anyone, including administrators. On approval it becomes a server secret that only ADCode's relay reads. Once the submission is approved or declined, it is deleted from the submission record." },
  { q: "What does a developer pay?", a: "Your price per million tokens plus ADCode's 35%, from USD credits they add in advance. Your model is listed with its price on ADCode's pricing page, beside every other model." },
  { q: "Can I change prices or limits later?", a: "Yes. Reply to our approval email, or submit the model again with the new figures. An approved model keeps working while a change is reviewed." },
  { q: "What if I only want to talk first?", a: "Use the application form on the main providers page. It asks for less and starts a conversation instead of a review." },
];

export default function ProviderModelsPage() {
  return (
    <div className="adv-page providers-page">
      <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "AI models", path: "/ai-models" }])} />
      <JsonLd data={faqPage(FAQ)} />

      <section className="adv-wrap provider-models-intro">
        <div>
          <p className="adv-eyebrow">AI models · <Link href="/providers">for model providers</Link></p>
          <h1 className="adv-hero-title">Put your AI models in ADCode</h1>
          <p className="adv-hero-lede">Enter your endpoint, a key for ADCode and each model&apos;s limits and prices. An administrator tests and approves them, and they go live in the model picker without anything retyped.</p>
        </div>
        <ol className="providers-steps provider-models-after" aria-label="What happens after you submit">
          {AFTER.map((step, index) => (
            <li key={step.title}><span className="providers-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.body}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="adv-wrap provider-models-section" aria-label="Submit your models">
        <ProviderModelsForm />
      </section>

      <section className="adv-faq adv-wrap" aria-labelledby="provider-models-faq-title">
        <h2 id="provider-models-faq-title">Before you submit</h2>
        <div>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}<span aria-hidden="true">+</span></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
