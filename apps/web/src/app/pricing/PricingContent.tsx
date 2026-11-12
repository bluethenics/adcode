import Link from "@/components/IntentLink";
import { type PricingOffer } from "@/lib/pricing";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";
import { Buck } from "@/components/buck/Buck";
import { WALLET_TOPUPS_CENTS } from "@adcode/api/src/modelWallet.ts";
import { ModelPrices } from "../ai-tokens/ModelPrices";

const WHERE_TO_MANAGE = "Where do I add credits or redeem a code?";

/** The questions, once: rendered below and published as FAQPage data by the page. */
export const PRICING_FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to pay to use ADCode?", a: "No. The editor is free, and Tagflow AI's sponsored models are free for every signed-in account. Every other model is paid from USD credits you add when you want them. Your own provider keys and local models also stay free to connect." },
  { q: "How much does a model cost?", a: `Each model has its own price per million tokens. The full list is on this page and in your account. A request holds its maximum possible charge while it runs and releases whatever it did not use, so you never pay for an answer you did not get.` },
  { q: "Is there a subscription?", a: "No. Plans ended on 6 November 2026. You add credits once and they never expire; nothing renews and nothing is charged automatically." },
  { q: "I had a plan. What happens to it?", a: "A plan you already paid for keeps working until its paid period ends, and until then it covers every model, premium ones included. It will not renew, and you will not be charged again. Unused credits from one-time packs were added to your USD credits at the price you paid." },
  { q: "What happens when my credits run out?", a: "Paid models pause with a message saying so, and Tagflow AI stays free. Add credits and send the message again; a paused task carries on where it stopped." },
  { q: WHERE_TO_MANAGE, a: "In AI credits, with the same ADCode account you use in the editor: your balance, every charge, the price list and promo codes. Checkout and official invoices are handled by Dodo Payments." },
];

const price = (cents: number): string => `$${cents / 100}`;

export function PricingContent({ offer }: { offer: PricingOffer; now?: number }) {
  const paid = offer.paidModels ?? [];
  const free = offer.freeModels ?? [];
  return (
    <div className="pricing-page marketplace-wrap">
      <header className="pricing-intro">
        <div>
          <Buck mood="earning" size={72} interactive greet="proud" label="Buck, flipping a coin. Tap him." />
          <p className="pricing-eyebrow">Pricing</p>
          <h1>Free to start.<br />Pay only for the models you use.</h1>
          <p>The editor and Tagflow AI cost nothing. Every other model is paid from USD credits at the price listed for it. No subscription, and nothing renews.</p>
        </div>
        <Link href="/ai-tokens#wallet" className="pricing-account">Add credits <Icon node={ArrowUpRight} /></Link>
      </header>

      {offer.available === false && <p className="pricing-notice" role="status">Credit purchases are temporarily paused. The free editor and Tagflow AI are still available.</p>}

      <section className="pricing-free" aria-labelledby="pricing-free-heading">
        <div className="pricing-free-title">
          <p className="pricing-eyebrow">Always free</p>
          <h2 id="pricing-free-heading">Free editor</h2>
          <p className="pricing-free-price">$0<span>No card, no trial</span></p>
          <Link href="/versions" className="pricing-button">Download ADCode <Icon node={ArrowUpRight} /></Link>
        </div>
        <div className="pricing-free-details">
          <p>Code, run your project and work with agents without paying anything.</p>
          <dl>
            <div><dt>Tagflow AI</dt><dd>{free.length > 0 ? `${free.join(", ")}: free for every signed-in account, sponsored by Tagflow.` : "Tagflow's sponsored models: free for every signed-in account."}</dd></div>
            <div><dt>Your own models</dt><dd>Connect a provider key, a coding CLI you already use, or a local model. Your provider sets its own prices.</dd></div>
          </dl>
          <p className="pricing-small">Sponsored cards help fund the editor. Provider availability and model context limits still apply.</p>
        </div>
      </section>

      <section className="pricing-section" aria-labelledby="pricing-credits-heading">
        <header className="pricing-section-head">
          <h2 id="pricing-credits-heading">Pay as you go</h2>
          <p>Add credits once and use any model below. Credits are US dollars, never expire, and are charged only for what each request actually used.</p>
        </header>
        <ul className="pricing-packs" aria-label="Credit top-ups">
          {WALLET_TOPUPS_CENTS.map((cents) => (
            <li key={cents}>
              <div><strong>{price(cents)}<span>of credits</span></strong><p>Once. Never expires.</p></div>
              <Link href="/ai-tokens#wallet" aria-label={`Add ${price(cents)} of credits`}>Add <Icon node={ArrowUpRight} /></Link>
            </li>
          ))}
        </ul>
        <p className="pricing-small">Prices are in USD. Dodo calculates applicable tax and shows the final amount before you pay.</p>
      </section>

      <section className="pricing-section pricing-model-list" id="models" aria-labelledby="model-prices-title">
        {paid.length > 0 ? (
          <ModelPrices
            title={`Every model's price (${paid.length})`}
            models={paid.map((model) => ({ id: model.id, name: model.name, provider: model.provider, available: true, inputPrice: model.input, outputPrice: model.output, cacheInputPrice: model.cached }))}
          />
        ) : (
          <p className="pricing-notice" role="status">The live price list could not be loaded just now. Every model&apos;s price is also shown in <Link href="/ai-tokens#wallet">AI credits</Link> and in the editor&apos;s model picker.</p>
        )}
      </section>

      <section className="pricing-section pricing-retired" aria-labelledby="pricing-retired-heading">
        <header className="pricing-section-head">
          <h2 id="pricing-retired-heading">Had a plan?</h2>
          <p>Plans ended on 6 November 2026. A plan you already paid for covers every model until its paid period ends and will not renew. Unused credits from one-time packs were added to your USD credits at the price you paid.</p>
        </header>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Before you add credits</h2>
        {PRICING_FAQ.map((item) => <details key={item.q}><summary>{item.q}</summary><p>{item.a}{item.q === WHERE_TO_MANAGE && <> <Link href="/ai-tokens">Open AI credits</Link></>}</p></details>)}
      </section>
    </div>
  );
}
