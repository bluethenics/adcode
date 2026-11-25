import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight } from "lucide";
import { Icon } from "@/components/Icon";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { SOURCE } from "@/lib/site";
import "../advertisers/advertisers.css";
import "./contribute.css";

export const metadata: Metadata = pageMetadata({
  path: "/contribute",
  title: "Contribute to ADCode: join as a GitHub collaborator",
  socialTitle: "Help build ADCode, the open-source AI code editor",
  description: "ADCode is open source under Apache 2.0. Read the code, pick an issue, open a pull request, or ask to join as a collaborator on GitHub. No CLA, one repository, every test runnable on your machine.",
});

/** Opens a new GitHub issue asking to collaborate, so every request lands where the team reviews it. */
const COLLABORATE_URL = `${SOURCE.repo}/issues/new?${new URLSearchParams({
  title: "I'd like to collaborate on ADCode",
  body: [
    "**What I'd like to work on:**",
    "",
    "**Things I've built or contributed to (links):**",
    "",
    "**How much time I can give (roughly):**",
    "",
  ].join("\n"),
}).toString()}`;

const CONTRIBUTING_URL = `${SOURCE.repo}/blob/main/CONTRIBUTING.md`;
const REPO_NAME = SOURCE.repo.split("/").at(-1) ?? "adcode";
const ISSUES_URL = `${SOURCE.repo}/issues`;

const AREAS: readonly { id: string; title: string; where: string; body: string }[] = [
  { id: "chat", title: "The AI chat and agents", where: "packages/ai, apps/desktop/src/renderer/ai", body: "The assistant people use all day: fork chats that work in parallel, /goal, Claude Code and Codex usage, long-session speed. Plain TypeScript with tests, no editor needed to run them." },
  { id: "editor", title: "The editor", where: "apps/desktop, packages/lsp, packages/git", body: "Monaco, language servers, terminals, git, the preview server. If something in your daily editing annoys you, it is probably a small change here." },
  { id: "web", title: "Website and docs", where: "apps/web, packages/help", body: "Every feature has a plain-language help entry and a web guide generated from the same source. Clearer words and better examples help every new user." },
  { id: "ledger", title: "The ad server and ledger", where: "services/api", body: "The server-side receipt check that makes earnings honest. Careful, well-tested changes only; this is the code that decides who gets paid." },
];

const STEPS: readonly { title: string; body: string; code?: string }[] = [
  { title: "Fork and run it", body: "Fork the repository on GitHub, clone your fork, and start the editor. You need Node 24 and npm 11.", code: "npm install\nnpm start" },
  { title: "Pick something", body: "Take an open issue, or open one describing what you want to change. Small, focused changes are the quickest to review." },
  { title: "Check it and open a pull request", body: "Run every check locally, then open a pull request against main. CI runs the same command.", code: "npm run verify" },
];

const FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to sign a CLA?", a: "No. By contributing you agree your change is licensed under the Apache License 2.0, the same licence as the project." },
  { q: "Can I work on it without ADCode's servers?", a: "Yes. npm run mock-server serves the ad contract locally, and the editor runs against it with no backend at all. CONTRIBUTING.md has the exact commands." },
  { q: "What makes a pull request easy to merge?", a: "One change at a time, tests that cover it, and for anything a person can see, a help entry and a docs guide in the same change. A feature nobody can find does not ship." },
  { q: "How do I become a collaborator?", a: "Press Ask to collaborate on this page. It opens a GitHub issue where you say what you would like to work on; the team reads every one and invites collaborators to the repository from there." },
];

export default function ContributePage() {
  return (
    <div className="adv-page contribute-page">
      <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Contribute", path: "/contribute" }])} />
      <JsonLd data={faqPage(FAQ)} />

      <section className="adv-hero adv-wrap">
        <div className="adv-hero-copy">
          <p className="adv-eyebrow">Open source · Apache 2.0</p>
          <h1 className="adv-hero-title">Help build the editor you use every day</h1>
          <p className="adv-hero-lede">ADCode is developed in the open: the editor, the assistant, this website and the ad server are one repository you can read, run and change. We are inviting collaborators.</p>
          <div className="adv-actions">
            <a className="adv-primary" href={COLLABORATE_URL} target="_blank" rel="noopener noreferrer">Ask to collaborate <Icon node={ArrowRight} /></a>
            <a className="adv-secondary" href={SOURCE.repo} target="_blank" rel="noopener noreferrer">Open the repository <Icon node={ArrowUpRight} /></a>
          </div>
        </div>
        <figure className="contribute-terminal" aria-label="Getting started from source">
          <figcaption>Your first run</figcaption>
          <pre><code>{`git clone https://github.com/<you>/${REPO_NAME}.git\ncd ${REPO_NAME}\nnpm install\nnpm start          # the editor\nnpm run verify     # every check CI runs`}</code></pre>
        </figure>
      </section>

      <section className="contribute-areas adv-wrap" aria-labelledby="contribute-areas-heading">
        <h2 id="contribute-areas-heading">Where help counts most</h2>
        <div className="contribute-area-grid">
          {AREAS.map((area) => (
            <article key={area.id} className="contribute-area">
              <h3>{area.title}</h3>
              <p>{area.body}</p>
              <code>{area.where}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="contribute-how adv-wrap" aria-labelledby="contribute-how-heading">
        <div>
          <h2 id="contribute-how-heading">From clone to pull request</h2>
          <ol className="contribute-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="contribute-step-number" aria-hidden="true">{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  {step.code === undefined ? null : <pre><code>{step.code}</code></pre>}
                </div>
              </li>
            ))}
          </ol>
        </div>
        <aside className="contribute-links" aria-label="Contributor links">
          <h3>Before you start</h3>
          <ul>
            <li><a href={CONTRIBUTING_URL} target="_blank" rel="noopener noreferrer">Read CONTRIBUTING.md <Icon node={ArrowUpRight} /></a></li>
            <li><a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">Browse open issues <Icon node={ArrowUpRight} /></a></li>
            <li><a href="/docs">See what every feature does <Icon node={ArrowUpRight} /></a></li>
            <li><a href={SOURCE.licenceUrl} target="_blank" rel="noopener noreferrer">Licence: {SOURCE.licence} <Icon node={ArrowUpRight} /></a></li>
          </ul>
        </aside>
      </section>

      <section className="contribute-join adv-wrap" aria-labelledby="contribute-join-heading">
        <div className="contribute-join-card">
          <h2 id="contribute-join-heading">Join as a collaborator</h2>
          <p>Want to help regularly? Tell us what you would like to work on. Your request opens as a GitHub issue, the team reads every one, and collaborators are invited to the repository from there.</p>
          <a className="adv-primary" href={COLLABORATE_URL} target="_blank" rel="noopener noreferrer">Ask to collaborate <Icon node={ArrowRight} /></a>
        </div>
      </section>

      <section className="contribute-faq adv-wrap" aria-labelledby="contribute-faq-heading">
        <h2 id="contribute-faq-heading">Questions</h2>
        <dl>
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
