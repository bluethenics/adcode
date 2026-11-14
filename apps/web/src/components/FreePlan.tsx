import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";
import Link from "next/link";
import { WALLET_CUSTOM_MIN_CENTS } from "@adcode/api/src/modelWallet.ts";

export function FreePlan() {
  return (
    <section className="free-plan marketplace-wrap" id="free-plan" aria-labelledby="free-plan-heading">
      <header className="free-plan-head">
        <p className="marketplace-eyebrow">FREE TO START</p>
        <h2 id="free-plan-heading">Free editor. Pay only for the models you use.</h2>
        <p className="free-plan-intro">Start without a subscription or credit card. Tagflow AI is free for every signed-in account. Every other model is paid from USD credits at the price listed for it.</p>
      </header>
      <dl className="free-plan-grid">
        <div>
          <dt>Tagflow AI</dt>
          <dd><strong>Free</strong> for every signed-in account</dd>
        </div>
        <div>
          <dt>Every other model</dt>
          <dd><strong>Each model&apos;s listed price</strong>, per million tokens</dd>
        </div>
        <div>
          <dt>Credits</dt>
          <dd><strong>Any amount from ${WALLET_CUSTOM_MIN_CENTS / 100}</strong> once, never expire</dd>
        </div>
      </dl>
      <p className="free-plan-limit">Need more? A plan adds fresh credits every day, or add credits in any amount when you want them; each request is charged only for what it used. Your own provider key, a coding CLI you already pay for, or a local model also work, billed by their own provider. Provider availability and model context limits still apply.</p>
      <p className="free-plan-foot"><Link href="/pricing" className="home-text-link">See every model&apos;s price <Icon node={ArrowUpRight} /></Link></p>
      <details className="free-plan-details">
        <summary>How free use works</summary>
        <div>
          <p>Sign in with a verified email and choose Tagflow AI in the model picker. No key and no card.</p>
          <p>Idle cloud workspaces sleep automatically and resume with your work saved. Your own provider key follows that provider’s billing.</p>
          <Link href="/docs/ai-credits">Read about AI credits <Icon node={ArrowUpRight} /></Link>
        </div>
      </details>
    </section>
  );
}
