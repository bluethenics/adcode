import Link from "next/link";
import type { Metadata } from "next";
import { LedgerHero, HeroTotal } from "@/components/LedgerHero";
import { InstallCommand } from "@/components/InstallCommand";
import { JsonLd } from "@/components/JsonLd";
import { FAQ, faqPage } from "@/lib/schema";
import { ECONOMICS, formatMicros, perImpressionMicros, SITE, url } from "@/lib/site";

export const metadata: Metadata = {
  title: `${SITE.name} - ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: url("/") },
};

const WINDOWS_COMMAND = "irm https://adcode.dev/install.ps1 | iex";

/**
 * What the editor will not interrupt. Taken from the scheduler's real suppression order
 * in `packages/ads/src/scheduler.ts`, because a page describing restraint the product
 * does not actually practise is worse than saying nothing.
 */
const RESTRAINT = [
  ["While you are typing", "A card never appears mid-keystroke. The editor waits for a pause."],
  ["During a debug session", "Nothing interrupts a breakpoint, a step, or a running terminal command."],
  ["When the window is not focused", "An ad you did not see is not an ad you get paid for, so it is not shown."],
  ["More often than your cadence", "Four an hour by default. Set it lower, or off, in settings."],
  ["Past the server's cap", "The server can tighten the limit but never loosen it, so a bad config cannot flood you."],
] as const;

const FEATURES = [
  ["Monaco, the editor from VS Code", "The same editing surface, with completions in every language it highlights."],
  ["Real terminals", "Several at once, with a shell launcher. Not a log pane pretending to be a shell."],
  ["Git that explains itself", "Stage, commit, branch, blame, and a commit browser with safe per-file restore."],
  ["Errors in plain English", "Around 40 compiler messages rewritten to assume nothing. 'You're putting text where a number belongs.'"],
  ["Four AI providers", "Bring your own key. Completions, chat, and an agent loop that shows its diffs before applying them."],
  ["Live collaboration", "Share a session over your network, with per-participant permissions."],
] as const;

export default function Home() {
  const hourly = perImpressionMicros * BigInt(ECONOMICS.adsPerHourStandard);

  return (
    <>
      <JsonLd data={faqPage(FAQ)} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="band-ink hero">
        <div className="wrap hero-grid">
          <div>
            <h1>
              An editor that
              <br />
              pays you back.
            </h1>

            <p className="hero-lede">
              ADCode is a full IDE — Monaco editing, real terminals, git, four AI providers.
              Every so often a sponsored card appears in the corner. You get half of what the
              advertiser paid, credited to a ledger you can audit down to the millionth of a
              dollar.
            </p>

            <HeroTotal />

            <div className="hero-cta">
              <Link href="/download" className="btn btn-primary">
                Download for free
              </Link>
              <InstallCommand command={WINDOWS_COMMAND} />
            </div>

            <p className="hero-note">
              Free forever. No account needed to start. Windows, macOS, and Linux.
            </p>
          </div>

          <LedgerHero />
        </div>
      </section>

      {/* ── The ledger ─────────────────────────────────────────────────── */}
      <section className="band" id="ledger">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Every cent has a receipt</p>
            <h2>The ledger is append-only. Corrections are reversals, never edits.</h2>
            <p className="lede">
              When an ad earns you money, a row is written. Nothing is ever changed or deleted
              afterwards. If a credit has to be taken back — a fraudulent impression, a
              correction — a second row appears that points at the first one, and both stay
              visible forever.
            </p>
          </div>

          <div className="grid grid-3">
            <div className="card">
              <h3>You see what we see</h3>
              <p>
                The same rows, the same descriptions, the same amounts, in the editor and on
                your dashboard. There is no internal view with different numbers in it.
              </p>
            </div>
            <div className="card">
              <h3>Nobody can quietly rewrite it</h3>
              <p>
                An administrator cannot edit a past entry, because the system has no operation
                that edits one. Every administrative action on an account is itself recorded.
              </p>
            </div>
            <div className="card">
              <h3>The maths is not ours to fudge</h3>
              <p>
                Advertisers pay {formatMicros(ECONOMICS.cpmMicros, 2)} per thousand views. Your
                share is {String(ECONOMICS.revSharePercent)}%, which is{" "}
                <span className="money">{formatMicros(perImpressionMicros)}</span> a card,
                computed on the server and written to the row.
              </p>
            </div>
          </div>

          <p style={{ marginTop: 28, color: "var(--muted)", fontSize: 15, maxWidth: "68ch" }}>
            To be plain about the scale: at the default cadence that is about{" "}
            <span className="money">{formatMicros(hourly, 3)}</span> for an hour of active
            editing. ADCode is a way to use a capable editor for free with some money coming
            back — not a way to earn a living. We would rather say so here than have you work
            it out later.
          </p>
        </div>
      </section>

      {/* ── Restraint ──────────────────────────────────────────────────── */}
      <section className="band band-ink" id="restraint">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">When ads appear</p>
            <h2>An ad that breaks your concentration has already cost more than it paid.</h2>
            <p className="lede">
              The rules below are enforced in the editor, in this order. They are not
              preferences we hope to honour.
            </p>
          </div>

          <dl className="rule-list" style={{ borderColor: "var(--ink-hairline)" }}>
            {RESTRAINT.map(([term, desc]) => (
              <div className="rule" key={term} style={{ borderColor: "var(--ink-hairline)" }}>
                <dt className="rule-term" style={{ color: "var(--on-ink)" }}>
                  {term}
                </dt>
                <dd className="rule-desc" style={{ margin: 0, color: "var(--on-ink-muted)" }}>
                  {desc}
                </dd>
              </div>
            ))}
          </dl>

          <p style={{ marginTop: 26, color: "var(--on-ink-muted)", fontSize: 15, maxWidth: "68ch" }}>
            Targeting uses a fixed list of 45 generic tags — the language and framework you
            have open, like <code className="mono">lang:rust</code> or{" "}
            <code className="mono">fw:react</code>. Your file contents, paths, and project
            names never leave the machine.
          </p>
        </div>
      </section>

      {/* ── The editor ─────────────────────────────────────────────────── */}
      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">What you are actually getting</p>
            <h2>A real editor, not a demo with a banner in it.</h2>
          </div>

          <div className="grid grid-2">
            {FEATURES.map(([title, desc]) => (
              <div className="card" key={title}>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Advertisers ────────────────────────────────────────────────── */}
      <section className="band band-ink">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">For advertisers</p>
            <h2>Reach developers in the one place they are paying attention.</h2>
            <p className="lede">
              Target by the language, framework, or tool actually open in the editor. Pay per
              verified view — a receipt only bills you if the card was really served and really
              seen, and half of what you pay goes to the developer who saw it.
            </p>
          </div>
          <div className="hero-cta">
            <Link href="/advertise" className="btn btn-primary">
              Start a campaign
            </Link>
            <Link href="/portal" className="btn btn-ghost">
              Advertiser sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Questions</p>
            <h2>The things people ask first.</h2>
          </div>

          <div className="faq">
            {FAQ.map((item) => (
              <div className="faq-item" key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
