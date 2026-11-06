import type { Metadata } from "next";
import { ArrowRight } from "lucide";
import { Icon } from "@/components/Icon";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { ProviderApplicationForm } from "./ProviderApplicationForm";
import "../advertisers/advertisers.css";
import "./providers.css";

export const metadata: Metadata = pageMetadata({
  path: "/providers",
  title: "Model providers: offer your models inside ADCode",
  socialTitle: "Put your models in ADCode's model picker",
  description: "AI labs and inference providers can apply to offer their models to developers in ADCode: free and sponsored, sold as credits, or listed for people's own keys. One short form, no account needed.",
});

const OFFERS: readonly { id: string; title: string; body: string }[] = [
  { id: "free", title: "Free and sponsored", body: "Your model appears under Included AI, free to every signed-in developer. You cover the usage; ADCode routes requests and reports how the model performs." },
  { id: "paid", title: "Paid credits", body: "Developers on a paid plan, or with top-up credits, use your model through ADCode. You are paid for the tokens they use, at the price you set with us." },
  { id: "byok", title: "Bring your own key", body: "Your API appears as a ready connection. Developers paste their own key from your console and pay you directly." },
];

const STEPS: readonly { title: string; body: string }[] = [
  { title: "Apply", body: "Tell us who you are, which models, and how you would like them offered. It takes about a minute." },
  { title: "We test your endpoint", body: "We run your models through the editor's real work - chat, tool calls, long agent tasks - and share what we see." },
  { title: "Go live in the model picker", body: "Your models appear for everyone, with your name on them. Provider reports show requests, errors and speed." },
];

const REQUIREMENTS: readonly string[] = [
  "An OpenAI-compatible chat completions endpoint over HTTPS, with streaming",
  "Tool calling (function calling) for the models that should run agent tasks",
  "Stable model ids, and notice before one is retired",
  "Published rate limits and pricing per million input and output tokens",
  "No training on prompts or code sent from ADCode",
];

const PROVIDER_FAQ: readonly { q: string; a: string }[] = [
  { q: "Who can apply?", a: "AI labs, inference platforms and gateways serving models through an API. Open-weight models hosted by you count as well." },
  { q: "Do I need an ADCode account to apply?", a: "No. Fill in the form; we reply by email to the address you give." },
  { q: "How long does review take?", a: "We reply to every application. Testing an endpoint usually takes a few days, longer for a new family of models." },
  { q: "Can I offer some models free and others paid?", a: "Yes. Choose every way that interests you in the form, and say which models go where in the message." },
  { q: "What do developers see?", a: "Your model in the model picker with your name, its context size and, for paid models, what it costs in credits. Nothing about your margins or contract." },
];

export default function ProvidersPage() {
  return (
    <div className="adv-page providers-page">
      <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Model providers", path: "/providers" }])} />
      <JsonLd data={faqPage(PROVIDER_FAQ)} />

      <section className="adv-hero adv-wrap">
        <div className="adv-hero-copy">
          <p className="adv-eyebrow">For model providers</p>
          <h1 className="adv-hero-title">Your models, in the editor developers build with</h1>
          <p className="adv-hero-lede">ADCode is a free AI code editor with a model picker people choose from every day. Apply to put your models in it, free and sponsored, as paid credits, or for people&apos;s own keys.</p>
          <div className="adv-actions">
            <a className="adv-primary" href="#apply">Apply in a minute <Icon node={ArrowRight} /></a>
            <a className="adv-secondary" href="/providers/models">Submit models directly <Icon node={ArrowRight} /></a>
          </div>
        </div>
        <figure className="providers-picker" aria-label="Where your model appears: ADCode's model picker">
          <div className="providers-picker-card">
            <p className="providers-picker-head">Model</p>
            <ul>
              <li><span className="providers-dot" />Auto<small>Picks a model for each task</small></li>
              <li data-yours="true"><span className="providers-dot" />Your model<small>Your company · 128k context</small><em>Included</em></li>
              <li><span className="providers-dot" />Another included model<small>Free under fair use</small><em>Included</em></li>
              <li><span className="providers-dot" />Your model, larger<small>Paid credits · 1.4 credits per 1k tokens</small></li>
              <li><span className="providers-dot" />Your API, your key<small>Bring your own key</small></li>
            </ul>
          </div>
          <figcaption>Where your models appear: the model picker beside every message. Example entries.</figcaption>
        </figure>
      </section>

      <section className="adv-wrap providers-offers" aria-labelledby="providers-offers-title">
        <h2 id="providers-offers-title">Three ways to be offered</h2>
        <div className="providers-offer-grid">
          {OFFERS.map((offer) => (
            <article key={offer.id} className="providers-offer">
              <h3>{offer.title}</h3>
              <p>{offer.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="adv-wrap providers-how" id="how" aria-labelledby="providers-how-title">
        <div>
          <h2 id="providers-how-title">From application to the model picker</h2>
          <ol className="providers-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}><span className="providers-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.body}</p></div></li>
            ))}
          </ol>
        </div>
        <div className="providers-requirements">
          <h3>What we need from your API</h3>
          <ul className="adv-facts">
            {REQUIREMENTS.map((item) => <li key={item}><span>{item}</span></li>)}
          </ul>
        </div>
      </section>

      <section className="adv-wrap providers-apply" id="apply" aria-labelledby="providers-apply-title">
        <div className="providers-apply-intro">
          <h2 id="providers-apply-title">Apply</h2>
          <p>Five things are required and the rest is optional. No account needed; we reply to the email you give, usually within a few days.</p>
          <p>Already know which models, limits and prices? <a href="/providers/models">Submit them directly</a> with your endpoint and a key, and they go live as soon as an administrator approves.</p>
        </div>
        <ProviderApplicationForm />
      </section>

      <section className="adv-faq adv-wrap" aria-labelledby="providers-faq-title">
        <h2 id="providers-faq-title">Questions providers ask</h2>
        <div>
          {PROVIDER_FAQ.map((item) => (
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
