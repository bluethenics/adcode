import Link from "next/link";
import type { Metadata } from "next";
import { DesktopMockup } from "@/components/DesktopMockup";
import { HeroHeadline } from "@/components/HeroHeadline";
import { HeroCircuit } from "@/components/HeroCircuit";
import { HeroProduct } from "@/components/HeroProduct";
import { JsonLd } from "@/components/JsonLd";
import { FAQ, faqPage } from "@/lib/schema";
import { ECONOMICS, formatMicros, perImpressionMicros, SITE, SITE_ORIGIN, url } from "@/lib/site";

export const metadata: Metadata = { title: `${SITE.name} - ${SITE.tagline}`, description: SITE.description, alternates: { canonical: url("/") } };

const FEATURES = [
  ["A full desktop workspace", "Monaco editing, real terminals, Git, diagnostics, and workspaces that stay out of your way."],
  ["AI on your terms", "Bring the provider and key you want. Review every diff before it changes your code."],
  ["Ads that respect focus", "A sponsor card waits for a pause; it never cuts into typing, debugging, or an unfocused window."],
] as const;
const RESTRAINT = [["Typing", "No sponsored card appears while you are writing."], ["Debugging", "Breakpoints, terminal commands, and active sessions are left alone."], ["Your privacy", "Only generic language and framework tags are used—never code, files, or paths."]] as const;

export default function Home() {
  const perCard = formatMicros(perImpressionMicros);
  return <><JsonLd data={faqPage(FAQ)} /><a className="skip-link" href="#main">Skip to content</a>
    <section className="home-hero"><HeroCircuit /><div className="wrap home-hero-grid"><div className="hero-copy"><p className="eyebrow eyebrow-live"><span /> ADCode desktop · free forever</p><HeroHeadline /><p className="hero-lede">A complete code editor, funded by respectful ads. You keep half of every verified payment.</p><HeroProduct /><div className="hero-actions"><Link href="/download" className="btn btn-primary btn-large hero-download"><span aria-hidden="true">↓</span> Download ADCode for Windows <i>· 64-bit</i></Link></div><div className="hero-subactions"><span>Windows 10 or later</span><Link href="/download">All downloads <span aria-hidden="true">↗</span></Link></div></div></div></section>
    <section className="proof-strip" aria-label="ADCode product facts"><div className="wrap proof-grid"><p><strong>Real IDE</strong><span>Editor, terminal, Git, AI</span></p><p><strong>{perCard}</strong><span>developer share per view</span></p><p><strong>{formatMicros(ECONOMICS.cpmMicros, 2)} CPM</strong><span>verified advertiser views</span></p><p><strong>0</strong><span>data sold from your files</span></p></div></section>
    <section className="band" id="how-it-works"><div className="wrap"><div className="section-head section-head-wide"><p className="eyebrow">A proper editor first</p><h2>The tools you need. A business model you can inspect.</h2><p className="lede">ADCode is not an extension with a banner attached. It is a desktop workspace built for the work between the first keystroke and the final commit.</p></div><div className="feature-grid">{FEATURES.map(([title, description], index) => <article className="feature-card" key={title}><span className="feature-index">0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div></div></section>
    <section className="band band-night" id="ledger"><div className="wrap split-layout"><div className="section-head"><p className="eyebrow">Every cent has a receipt</p><h2>Your earnings are a ledger, not a promise.</h2><p className="lede">Each verified view creates a row. Corrections create an equally visible reversal. Nothing gets quietly changed after the fact.</p><Link href="/download" className="text-link">Start earning with ADCode <span aria-hidden="true">→</span></Link></div><div className="ledger-panel"><div className="ledger-panel-head"><span>ADCode earnings</span><span className="status-dot">Live</span></div><div className="ledger-total"><span>Available balance</span><strong className="money">$0.000640</strong></div>{["Verified editor card", "Verified editor card", "Receipt settled"].map((text, index) => <div className="ledger-item" key={`${text}-${index}`}><span>{text}</span><b className="money">+{perCard}</b></div>)}</div></div></section>
    <section className="band" id="restraint"><div className="wrap split-layout split-layout-top"><div className="section-head"><p className="eyebrow">Respect is a feature</p><h2>Focus comes before revenue.</h2></div><dl className="rule-list rule-list-light">{RESTRAINT.map(([term, desc]) => <div className="rule" key={term}><dt>{term}</dt><dd>{desc}</dd></div>)}</dl></div></section>
    <section className="band advertiser-callout"><div className="wrap advertiser-callout-grid"><div><p className="eyebrow">For advertisers</p><h2>Meet developers where the work is happening.</h2><p>Buy verified attention in a carefully bounded placement. Half of every payment goes to the developer who saw it.</p></div><Link href="/advertise" className="btn btn-light btn-large">Start a campaign <span aria-hidden="true">→</span></Link></div></section>
    <section className="band"><div className="wrap"><div className="section-head"><p className="eyebrow">Questions</p><h2>Before you download.</h2></div><div className="faq">{FAQ.map((item) => <article className="faq-item" key={item.q}><h3>{item.q}</h3><p>{item.a}</p></article>)}</div></div></section>
  </>;
}
