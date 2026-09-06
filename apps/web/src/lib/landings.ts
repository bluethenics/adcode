/**
 * The pages written to be found, rather than to be browsed to.
 *
 * The site is deliberately one marketing page plus `/docs` - see the redirect stubs at
 * `/blog` and `/download`, which are a product decision and not an oversight. That shape
 * is good for a visitor who already knows what ADCode is and useless for the person who
 * does not, because it offers a search engine exactly one page to match against every
 * query in the category. Somebody typing "free AI code editor" is not searching for a
 * brand they have never heard of; they are describing a need, and nothing here was written
 * in the words they used to describe it.
 *
 * These pages are. Each one answers a question a person actually types, in full sentences,
 * with the comparison or the arithmetic they came for. They are not doorway pages: every
 * one says something the homepage does not, and the honest answer - including "keep using
 * VS Code if the extension you depend on is not on Open VSX" - is part of the point. A
 * page that only flatters the product is one an answer engine learns to stop quoting.
 *
 * One module rather than a folder of near-identical route files, because five surfaces
 * have to agree about what exists: the routes, the sitemap, `llms.txt`, `llms-full.txt`,
 * and the internal links between them. Adding an entry here adds it to all five.
 */
import type { Metadata } from "next";
import { ECONOMICS, SITE, formatMicros, perImpressionMicros, url } from "./site";

/** A block of prose under its own heading. `body` paragraphs are plain text, not markdown. */
export interface LandingSection {
  heading: string;
  body: readonly string[];
  /** An optional bullet list rendered after the paragraphs. */
  points?: readonly string[];
}

/** One row of a comparison table: what the alternative does, and what ADCode does. */
export interface ComparisonRow {
  aspect: string;
  them: string;
  us: string;
}

export interface Landing {
  slug: string;
  /** The `<title>`. Written as the query plus the answer, not as a slogan. */
  title: string;
  description: string;
  /** The on-page `<h1>`, which may differ from the title tag. */
  heading: string;
  /** The opening paragraph. Answers the query in the first sentence, before any pitch. */
  lede: string;
  sections: readonly LandingSection[];
  /** Page-specific questions. Emitted as FAQPage *and* rendered, never one without the other. */
  faq: readonly { q: string; a: string }[];
  /** Present on comparison pages. `subject` is the product being compared against. */
  comparison?: {
    subject: string;
    rows: readonly ComparisonRow[];
    /** The honest case for choosing the other one. Non-optional on comparison pages. */
    whenNotUs: string;
  };
  /** Slugs of the other landings worth reading next. */
  related: readonly string[];
  /** Last substantive edit, ISO date. Feeds `dateModified` and the sitemap. */
  updated: string;
}

/*
 * Three decimals, not six.
 *
 * `formatMicros` defaults to six because the ledger does not round and a balance must not
 * appear to. Prose is the opposite case: "$0.001000 per impression" makes a reader count
 * zeroes to find the number, and the trailing three are always zero at this rate anyway.
 * The ledger keeps its precision; the sentence gets the figure.
 */
const perImpression = formatMicros(perImpressionMicros, 3);
const floorBlock = formatMicros(ECONOMICS.floorBlockMicros, 2);

/**
 * The comparison pages live under `/compare/`, the rest at the root.
 *
 * The prefix is not decoration. A comparison page competes for "<product> alternative",
 * which is a query about somebody else's product, and grouping them means the index page
 * at `/compare` can rank for the plural form while each child takes its own name. The two
 * root pages compete for category terms that are nobody's brand, so a prefix would only
 * put a word in front of the one that matters.
 */
export const COMPARE_PREFIX = "/compare";

export const isComparison = (page: Landing): boolean => page.comparison !== undefined;

export const landingPath = (page: Landing): string =>
  isComparison(page) ? `${COMPARE_PREFIX}/${page.slug}` : `/${page.slug}`;

export const LANDINGS: readonly Landing[] = [
  {
    slug: "free-ai-code-editor",
    title: "A free AI code editor with no subscription and no trial",
    description:
      "ADCode is a full desktop IDE with four AI providers built in, free permanently rather than free for fourteen days. Here is what it includes, what it costs, and how it is funded.",
    heading: "A free AI code editor, funded without charging you",
    lede: `ADCode is a free AI code editor for Windows, macOS, and Linux. It is not a trial, a community edition, or a free tier with a request cap - the editor is funded by advertisers, so there is no subscription to start and none to cancel. This page covers what is included, how the funding works, and where the limits actually are.`,
    updated: "2026-09-02",
    sections: [
      {
        heading: "What 'free' means here, precisely",
        body: [
          "Most editors described as free are free in one of three narrower senses: free for a period, free until a usage cap, or free of charge but not of an account requirement. ADCode is none of those. There is no paid tier to be upgraded to, which means there is also no feature held back to make one worth buying.",
          "The funding comes from a sponsored card that appears in the corner of the window at a cadence you control. That is the trade, stated plainly: an occasional advertisement instead of a monthly charge. Half of what the advertiser pays is credited to the developer who saw it, which is the part that makes the arrangement different from simply putting ads in a product.",
        ],
        points: [
          "No subscription, no trial period, no seat count, no card on file.",
          "No request cap on the AI features - you supply the provider key, so the limit is your own account's.",
          "No feature reserved for a paid edition, because there is no paid edition.",
          "Ads can be reduced or switched off entirely in settings; the earnings stop with them.",
        ],
      },
      {
        heading: "What the AI actually does",
        body: [
          "Four providers are supported and you choose which one handles a request, so the editor is not a wrapper around a single vendor whose pricing you inherit. You bring your own key, which means the model choice, the spend, and the data policy are decided in your account rather than in ours.",
          "The features that use it are the ones worth using: inline completion, a chat that can read the files you point it at, and plain-English compiler errors that turn a wall of template instantiation into a sentence. Nothing is sent to a provider unless you asked for something that requires it.",
        ],
      },
      {
        heading: "The rest of the editor",
        body: [
          "An AI feature bolted onto a weak editor is still a weak editor. The base here is Monaco - the editing surface from VS Code - with the things a working day needs rather than a demo's worth.",
        ],
        points: [
          "Multiple integrated terminals, with real shells rather than a command runner.",
          "Git: stage, commit, branch, blame, and a browsable commit history.",
          "Workspace-wide search and replace.",
          "A built-in preview server for web work.",
          "Live collaboration on a workspace.",
          "Local file history, so an unsaved-over change is recoverable without a commit.",
        ],
      },
      {
        heading: "How it is funded, in numbers",
        body: [
          `Advertisers bid in a second-price auction starting at ${floorBlock} per 500 impressions. The developer who saw the ad is credited ${String(ECONOMICS.revSharePercent)}% of the winning bid's clearing price - about ${perImpression} per impression at the floor, more when demand is higher.`,
          "Every credit is a row on an append-only ledger you can read in the editor and on the web. Entries are never edited or deleted; a correction is a separate reversal that references the original. That is a deliberate constraint on us, not a feature for you: it means the earnings figure cannot be quietly adjusted after the fact.",
        ],
      },
      {
        heading: "What it does not do",
        body: [
          "It does not read your source code to target advertising. Targeting uses a fixed vocabulary of 45 generic tags - the language and framework in use, such as `lang:rust` or `fw:react`. File contents, file paths, and project names never leave the machine.",
          "It does not run a marketplace with tens of thousands of extensions. If your work depends on a specific proprietary VS Code extension, that is a real reason to stay where you are, and the comparison page says so at more length.",
        ],
      },
    ],
    faq: [
      {
        q: "Is ADCode actually free, or free for a limited time?",
        a: "ADCode is free permanently. There is no trial period, no paid tier, and no feature held back for one. The editor is funded by advertisers rather than by subscriptions, which is why there is nothing to upgrade to.",
      },
      {
        q: "Do I need to pay for the AI features in ADCode?",
        a: "Not to ADCode. The editor supports four AI providers and you supply your own API key, so any cost is the one your provider charges you directly. ADCode adds no markup and imposes no request cap of its own.",
      },
      {
        q: "What is the catch with a free AI code editor?",
        a: "The trade is an occasional sponsored card in the corner of the editor window. It never interrupts typing, debugging, or a running terminal command, it is rate limited, and it can be switched off in settings - though switching it off also stops the earnings, since the two are the same mechanism.",
      },
      {
        q: "Does a free code editor mean my code is the product?",
        a: "No. Ad targeting uses a fixed list of 45 generic tags such as the programming language and framework in use. File contents, file paths, and project names are never transmitted. The advertiser learns that somebody writing Rust saw their card, and nothing else.",
      },
    ],
    related: ["earn-while-you-code", "vscode", "cursor"],
  },
  {
    slug: "earn-while-you-code",
    title: "Get paid to code: how developers earn from an ad-supported editor",
    description:
      "An honest account of earning money while programming in ADCode - the auction, the revenue share, the arithmetic on a realistic working month, and why it is beer money rather than income.",
    heading: "Getting paid to code, and what that is actually worth",
    lede: `ADCode credits you a share of what advertisers pay to reach you while you work. This page sets out how much that is, using the real rates rather than a best case: what one impression pays, what a normal working month adds up to, and why the honest description is "your editor and your AI subscription pay for themselves" rather than "a second income".`,
    updated: "2026-09-02",
    sections: [
      {
        heading: "The mechanism, in one paragraph",
        body: [
          `A sponsored card appears in the corner of the editor at a cadence you set. Advertisers bid for the slot in a second-price auction - the winner pays the runner-up's price plus a step, not their own bid - with a floor of ${floorBlock} per 500 impressions. You are credited ${String(ECONOMICS.revSharePercent)}% of the clearing price, roughly ${perImpression} per impression at the floor.`,
        ],
      },
      {
        heading: "What a real month comes to",
        body: [
          `At the standard cadence the editor shows about ${String(ECONOMICS.adsPerHourStandard)} cards an hour. Six hours of editor time a day, twenty working days, is around ${String(ECONOMICS.adsPerHourStandard * 6 * 20)} impressions a month. At the floor price that is a low single-digit dollar figure; when demand for your tags is higher, the clearing price rises and so does the credit.`,
          "That is the number, and it is deliberately not dressed up. It will not replace a salary and it is not meant to. What it does cover, for most people, is the editor itself - which would otherwise be a subscription - and a meaningful share of the API spend on the AI features. The correct comparison is not to a job; it is to what you currently pay for the same tools.",
        ],
      },
      {
        heading: "What moves the number",
        body: [
          "Three things, none of which involve gaming anything:",
        ],
        points: [
          "Hours with the editor open and active. Idle time is not counted, and the server, not the client, decides what counts.",
          "The tags your work produces. A stack advertisers compete for clears above the floor; a niche one sits at it.",
          "Your ad cadence setting. More cards means more impressions, and the cap the server enforces cannot be raised from the client.",
        ],
      },
      {
        heading: "Why the ledger is append-only",
        body: [
          "Every credit is a row you can read, in the editor and on the web dashboard. Rows are never edited and never deleted; a correction is written as a separate reversal that references the entry it reverses.",
          "This is the part worth caring about. Any platform can display a balance, and a displayed balance is only as good as the promise not to quietly change it. An append-only ledger removes the ability rather than promising the restraint - if a figure was wrong, the correction is visible as its own row, with the original still sitting above it.",
        ],
      },
      {
        heading: "Getting paid out",
        body: [
          "Earnings accumulate as a balance and are withdrawn to a supported payout corridor once the balance clears the minimum. The withdrawal, the fee, and the resulting balance are all ledger rows like any other, so a payout is auditable the same way a credit is.",
        ],
      },
    ],
    faq: [
      {
        q: "How much can you earn coding in ADCode?",
        a: `Earnings depend on live advertiser demand. At the floor price of ${floorBlock} per 500 impressions, a developer is credited about ${perImpression} per impression, which over a normal working month comes to a low single-digit dollar figure. It is best understood as covering the cost of the editor and part of your AI provider spend, not as income.`,
      },
      {
        q: "Do I get paid for having the editor open without working?",
        a: "No. Impressions are only counted while the editor is genuinely in use, and the server rather than the client decides what qualifies. Leaving ADCode running on an idle machine earns nothing.",
      },
      {
        q: "When can I withdraw ADCode earnings?",
        a: "Once the balance clears the minimum for your payout corridor. The withdrawal itself is recorded on the same append-only ledger as the credits, so the fee and the resulting balance are both auditable.",
      },
      {
        q: "Can I increase my earnings by showing more ads?",
        a: "Up to a point. The ad cadence is a setting, and a higher cadence means more impressions - but the server enforces a cap the client cannot loosen, and impressions are only counted during genuine editor use.",
      },
    ],
    related: ["free-ai-code-editor", "idlen", "vscode"],
  },
  {
    slug: "vscode",
    title: "ADCode vs VS Code",
    description:
      "A straight comparison of ADCode and Visual Studio Code: the shared Monaco editing surface, what ADCode adds, what VS Code's extension marketplace still does better, and who should stay put.",
    heading: "ADCode vs Visual Studio Code",
    lede: `Both editors are free and both are built on Monaco, so the editing feels familiar moving either way. The real differences are three: ADCode has AI and a full git workflow in the box rather than through extensions, ADCode pays you a share of its advertising revenue, and VS Code has an extension marketplace that ADCode cannot match.`,
    updated: "2026-09-02",
    comparison: {
      subject: "Visual Studio Code",
      rows: [
        {
          aspect: "Price",
          them: "Free. Funded by Microsoft as a strategic loss-leader.",
          us: "Free. Funded by advertisers, who pay you half of what they bid.",
        },
        {
          aspect: "Editing surface",
          them: "Monaco.",
          us: "Monaco - the same one, so keybindings and editing behaviour carry over.",
        },
        {
          aspect: "AI",
          them: "Copilot as a paid subscription, or a third-party extension you configure.",
          us: "Four providers built in, your own API key, no ADCode markup or request cap.",
        },
        {
          aspect: "Git",
          them: "Built in, with blame and history usually added by extension.",
          us: "Built in: stage, commit, branch, blame, and a browsable commit history.",
        },
        {
          aspect: "Compiler errors",
          them: "Shown as the compiler wrote them.",
          us: "Also rewritten into plain English, with the original kept alongside.",
        },
        {
          aspect: "Extensions",
          them: "Tens of thousands, including proprietary Microsoft ones.",
          us: "A far smaller set. This is the honest gap.",
        },
        {
          aspect: "Telemetry",
          them: "On by default; opt out in settings.",
          us: "Ad targeting uses 45 generic tags. File contents, paths and project names never leave the machine.",
        },
        {
          aspect: "Earnings",
          them: "None.",
          us: `About ${perImpression} per impression, on an append-only ledger you can audit.`,
        },
      ],
      whenNotUs:
        "Stay on VS Code if your work depends on a specific proprietary extension - the Microsoft C++, C#, Python, or Remote Development packs are licensed for Microsoft's own builds and cannot legally be shipped elsewhere. That is a real dependency and no amount of ledger transparency substitutes for it. Stay too if you are deep in a Dev Containers or Codespaces workflow, which is genuinely excellent and which ADCode does not replicate.",
    },
    sections: [
      {
        heading: "What carries over on day one",
        body: [
          "The editing surface is the same one, so the muscle memory transfers: the command palette, multi-cursor, the go-to-symbol behaviour, and the keybindings you have internalised all work the way you expect. This is not a coincidence of design; it is literally Monaco in both cases.",
          "Open VSX extensions install normally, which covers most language servers, themes, and formatters. What does not carry over is anything Microsoft publishes only for its own builds.",
        ],
      },
      {
        heading: "What ADCode adds",
        body: [
          "The difference in practice is how much you have to assemble yourself. A working VS Code setup is usually the editor plus a dozen extensions, each with its own settings and its own upgrade risk. In ADCode the AI, the git history, the terminals, the preview server and the collaboration are all in the box and configured together.",
          "And it pays. Every sponsored card credits you half of what the advertiser paid, on a ledger you can read. Over a year that is roughly the difference between paying for an editor subscription and being paid a little for using one.",
        ],
      },
      {
        heading: "Where VS Code is genuinely ahead",
        body: [
          "The marketplace, and it is not close. Fifteen years of accumulated extensions is not something a new editor competes with, and pretending otherwise would be the sort of claim that makes the rest of this page not worth reading.",
          "Microsoft's first-party language packs are the sharpest edge of that. They are licensed for Microsoft's own builds, so no third-party editor can ship them - and for C#, C++, and some Python workflows they are meaningfully better than the open alternatives.",
        ],
      },
    ],
    faq: [
      {
        q: "Is ADCode a fork of VS Code?",
        a: "No. ADCode is built on Monaco, the same editing component VS Code uses, but it is a separate application rather than a fork of the VS Code shell. That is why the editing feels familiar while the surrounding features differ.",
      },
      {
        q: "Can I use my VS Code extensions in ADCode?",
        a: "Extensions published to Open VSX install normally, which covers most language servers, themes, and formatters. Extensions Microsoft publishes only for its own builds - the C++, C#, and Remote Development packs among them - are licensed so that no third-party editor can ship them.",
      },
      {
        q: "Is ADCode better than VS Code?",
        a: "For AI, git history, and cost recovery, ADCode does more in the box. For extension breadth and Microsoft's first-party language tooling, VS Code is ahead and will stay ahead. If a specific proprietary extension is load-bearing for your work, that decides it.",
      },
    ],
    related: ["cursor", "free-ai-code-editor", "earn-while-you-code"],
  },
  {
    slug: "cursor",
    title: "ADCode vs Cursor",
    description:
      "Cursor charges a monthly subscription for AI editing. ADCode gives you four providers on your own API key and pays you instead. A comparison of cost, model choice, and what Cursor still does better.",
    heading: "ADCode vs Cursor",
    lede: `Cursor is an AI-first editor with a monthly subscription and a bundled model allowance. ADCode is an AI-capable editor with no subscription, where you bring your own provider key and the editor pays you rather than the other way round. The trade is real in both directions and this page states it both ways.`,
    updated: "2026-09-02",
    comparison: {
      subject: "Cursor",
      rows: [
        {
          aspect: "Price",
          them: "A monthly subscription per seat.",
          us: "Free. No subscription and no paid tier.",
        },
        {
          aspect: "AI billing",
          them: "Bundled request allowance, then usage-based pricing above it.",
          us: "Your own provider key. ADCode adds no markup and no cap of its own.",
        },
        {
          aspect: "Model choice",
          them: "The models Cursor supports, on Cursor's routing.",
          us: "Four providers, chosen per request.",
        },
        {
          aspect: "AI depth",
          them: "Deeper. Whole-codebase indexing and multi-file agentic edits are the product.",
          us: "Completion, file-scoped chat, and plain-English compiler errors.",
        },
        {
          aspect: "Editing surface",
          them: "A VS Code fork.",
          us: "Monaco - the same editing component, in a separate application.",
        },
        {
          aspect: "Earnings",
          them: "None.",
          us: `About ${perImpression} per impression, credited on an append-only ledger.`,
        },
        {
          aspect: "Interruptions",
          them: "None.",
          us: "An occasional sponsored card in the corner. Rate limited, and switchable off.",
        },
      ],
      whenNotUs:
        "Choose Cursor if agentic multi-file editing is central to how you work. Its codebase indexing and its ability to plan and apply a change across many files are the strongest in the category, and ADCode's AI is deliberately narrower - completion, chat scoped to files you name, and error explanation. If you are paying Cursor because the agent saves you hours a week, that subscription is doing its job and this is not the trade you should take.",
    },
    sections: [
      {
        heading: "The cost comparison is not just the subscription",
        body: [
          "A subscription buys a bundled allowance, and above it you pay usage-based rates set by the vendor. With your own provider key the rate is the provider's, and the ceiling is your own account's rather than a tier you have to move up.",
          "Then there is the direction of the flow. Over a year, one editor charges you twelve times and the other credits you a small amount every working day. The absolute figures are not comparable - the credits are modest - but the sign is different, and for a developer whose tooling budget is their own money that matters more than the size.",
        ],
      },
      {
        heading: "Bring your own key, in practice",
        body: [
          "You paste a key from a provider you already have an account with, and choose which provider handles which kind of request. Nothing is sent anywhere until you ask for something that requires it.",
          "The practical benefit is that the data policy is the one you agreed to with your provider, not a second one layered on top by an editor vendor - and if a provider raises prices or deprecates a model, you switch in settings rather than waiting for the editor to support the change.",
        ],
      },
      {
        heading: "Where Cursor is genuinely ahead",
        body: [
          "Agentic editing. Cursor indexes a whole codebase and applies coordinated multi-file changes, and that is a materially harder problem than anything ADCode's AI attempts. ADCode does completion, chat over files you point it at, and compiler-error explanation - useful daily, but narrower by design.",
          "If that agent is why you pay, keep paying. A comparison page that told you otherwise would be selling something.",
        ],
      },
    ],
    faq: [
      {
        q: "Is there a free alternative to Cursor?",
        a: "ADCode is free and supports four AI providers on your own API key, with no subscription and no request cap of its own. Its AI is narrower than Cursor's - completion, file-scoped chat, and plain-English compiler errors rather than whole-codebase agentic editing.",
      },
      {
        q: "Does ADCode support the same models as Cursor?",
        a: "ADCode connects to four providers directly with your own key, so the models available are whichever ones your provider account has. Requests are not routed through ADCode, and no markup is added.",
      },
      {
        q: "Why would I use an ad-supported editor instead of paying for Cursor?",
        a: "Because the cost runs the other way. Cursor charges a monthly subscription; ADCode credits you a share of what advertisers pay to reach you. If Cursor's agentic editing saves you hours each week, the subscription is worth it - the trade only favours ADCode if you mostly want completion, chat, and a capable editor.",
      },
    ],
    related: ["vscode", "free-ai-code-editor", "earn-while-you-code"],
  },
  {
    slug: "idlen",
    title: "ADCode vs Idlen",
    description:
      "Both pay developers to see ads while coding. Idlen is a VS Code extension; ADCode is a complete editor with an auditable ledger. A comparison of what each one is, and which suits which situation.",
    heading: "ADCode vs Idlen",
    lede: `Idlen and ADCode share one idea - that a developer should be paid a share of the advertising revenue they generate - and differ in almost every decision after it. Idlen is an extension you add to the editor you already use. ADCode is the editor. That difference decides which one suits you, and it does not always decide in our favour.`,
    updated: "2026-09-02",
    comparison: {
      subject: "Idlen",
      rows: [
        {
          aspect: "What it is",
          them: "An extension for VS Code, Cursor, Windsurf and other VS Code builds.",
          us: "A complete desktop editor for Windows, macOS, and Linux.",
        },
        {
          aspect: "Keeping your setup",
          them: "Yes - it runs inside the editor you already have.",
          us: "No. Moving editors is a real cost and it belongs on this side of the table.",
        },
        {
          aspect: "Editor features",
          them: "Whatever your host editor has.",
          us: "Monaco, terminals, git with blame and history, search, preview server, collaboration.",
        },
        {
          aspect: "AI",
          them: "Whatever your host editor has.",
          us: "Four providers built in, on your own API key.",
        },
        {
          aspect: "Earnings record",
          them: "A balance in the extension.",
          us: "An append-only ledger, readable in the editor and on the web, with reversals rather than edits.",
        },
        {
          aspect: "Ad targeting data",
          them: "Reads package.json for relevance.",
          us: "45 generic tags. File contents, paths and project names never leave the machine.",
        },
        {
          aspect: "Advertiser side",
          them: "Not publicly self-serve.",
          us: "A self-serve auction with published floor prices and a public clearing history.",
        },
      ],
      whenNotUs:
        "Use Idlen if you are not willing to change editors, and you almost certainly should not be if a proprietary VS Code extension is load-bearing for your work or your team standardised on a setup you do not control alone. An extension that earns a little inside the editor you already trust beats a better editor you will not actually adopt.",
    },
    sections: [
      {
        heading: "The honest framing of the difference",
        body: [
          "An extension is a smaller ask and a smaller product. It cannot change how git history is browsed, what the terminal does, or how a compiler error is presented, because it does not own those surfaces. What it can do is add an earnings stream to a setup you already like - which, if you already like your setup, is exactly the right size of change.",
          "ADCode is the larger ask. It is worth making only if you also want the editor: the AI on your own key, the git workflow in the box, the plain-English errors. If the earnings are the only part you want, the extension is the more sensible purchase of your attention.",
        ],
      },
      {
        heading: "Where the difference is more than scope",
        body: [
          "Two places. The first is the earnings record. A balance shown in a panel is a number a vendor can change; an append-only ledger is one they cannot, because a correction has to be written as a visible reversal that references the original entry. When the entire proposition is 'we will pay you fairly', the difference between those two is the whole argument.",
          "The second is the advertiser side. ADCode runs a self-serve auction with a published floor and a visible clearing history, so what you are paid is derived from a price you can look up rather than a rate you are told. A revenue share is only meaningful when the revenue it is a share of is visible.",
        ],
      },
    ],
    faq: [
      {
        q: "What is the difference between ADCode and Idlen?",
        a: "Idlen is an extension that adds ad-supported earnings to VS Code and other VS Code builds, so you keep your existing editor. ADCode is a complete editor with its own AI, git, terminals, and an append-only earnings ledger. Idlen is the smaller change; ADCode is the larger one that also replaces the editor.",
      },
      {
        q: "Can I use ADCode and Idlen at the same time?",
        a: "They are separate products in separate editors, so nothing stops you running Idlen in VS Code and ADCode elsewhere. Each pays for impressions served in its own editor.",
      },
      {
        q: "Which pays more, ADCode or Idlen?",
        a: "It depends on live advertiser demand for your stack in each marketplace, so neither can honestly claim a fixed advantage. What ADCode publishes is the mechanism: a second-price auction with a stated floor, a 50% share of the clearing price, and every credit on a ledger you can audit.",
      },
    ],
    related: ["earn-while-you-code", "vscode", "free-ai-code-editor"],
  },
];

const BY_SLUG = new Map(LANDINGS.map((page) => [page.slug, page]));

export const getLanding = (slug: string): Landing | null => BY_SLUG.get(slug) ?? null;

export const comparisons = (): readonly Landing[] => LANDINGS.filter(isComparison);

export const guides = (): readonly Landing[] => LANDINGS.filter((page) => !isComparison(page));

/**
 * The related pages, resolved and with anything unknown dropped.
 *
 * A dangling slug in `related` is a broken internal link, and internal links are how a
 * crawler discovers these pages at all - none of them is reachable from the homepage nav.
 * Dropping silently rather than throwing keeps a typo from taking the build down, and
 * `landings.test.ts` fails on the typo instead.
 */
export const relatedLandings = (page: Landing): readonly Landing[] =>
  page.related.map((slug) => BY_SLUG.get(slug)).filter((item): item is Landing => item !== undefined);

/**
 * The `<head>` for a landing page.
 *
 * `title.absolute` on every one of them, deliberately. The layout template appends
 * " - ADCode", which is right for a doc page called "Format on save" and wrong here: these
 * titles are already full sentences sized to the ~60 characters a result will show, and
 * the suffix would push the end of the sentence past the truncation. The brand is in the
 * heading, the URL, and the breadcrumb line - it does not need to be in the title twice.
 */
export function landingMetadata(page: Landing): Metadata {
  const path = landingPath(page);
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url(path) },
    openGraph: {
      type: "article",
      title: page.title,
      description: page.description,
      url: url(path),
      siteName: SITE.name,
      modifiedTime: page.updated,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
  };
}

/** One line per page, for `llms.txt`. */
export const landingIndex = (): readonly { title: string; path: string; description: string }[] =>
  LANDINGS.map((page) => ({
    title: page.title,
    path: landingPath(page),
    description: page.description,
  }));

/** The full text of a page, flattened. Used by `llms-full.txt`. */
export function landingPlainText(page: Landing): string {
  const sections = page.sections
    .map((section) => {
      const points = section.points === undefined ? "" : `\n${section.points.map((p) => `- ${p}`).join("\n")}`;
      return `### ${section.heading}\n\n${section.body.join("\n\n")}${points}`;
    })
    .join("\n\n");

  const table =
    page.comparison === undefined
      ? ""
      : `\n\n### ${SITE.name} compared with ${page.comparison.subject}\n\n` +
        page.comparison.rows
          .map((row) => `- ${row.aspect} - ${page.comparison?.subject ?? ""}: ${row.them} ${SITE.name}: ${row.us}`)
          .join("\n") +
        `\n\nWhen not to choose ${SITE.name}: ${page.comparison.whenNotUs}`;

  const faq = page.faq.map((item) => `#### ${item.q}\n\n${item.a}`).join("\n\n");

  return `## ${page.heading}\n\n${page.lede}\n\n${sections}${table}\n\n${faq}`;
}
