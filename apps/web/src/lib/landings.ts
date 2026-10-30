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
import { pageMetadata } from "./seo";
import { ECONOMICS, SITE, formatMicros, perImpressionMicros } from "./site";
import { FREE_WEEKLY_TOKENS, PLAN_SUMMARY, tokenAmount } from "./pricing";

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
const includedAiSummary = `Tagflow AI and other free included models share ${tokenAmount(FREE_WEEKLY_TOKENS)} free tokens a day, with plans and packs for more. All Heabsy models are available on the free plan. No API key is needed for included models; your own key or local desktop model is optional.`;

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
    title: "A free AI code editor with optional AI plans - ADCode",
    description:
      "Use ADCode in your browser or on Windows and Linux. Start with free AI, agents and Git, then add an included AI plan or token pack when you need more.",
    heading: "A free AI code editor, funded without charging you",
    lede: `ADCode is a free AI code editor in your browser and on Windows and Linux. ${includedAiSummary} Sponsored cards help fund the editor, and you receive half of eligible ad revenue. This page explains what is included and where the limits apply.`,
    updated: "2026-10-27",
    sections: [
      {
        heading: "What 'free' means here, precisely",
        body: [
          `The editor requires no subscription and has no trial expiry. ${includedAiSummary} Sign in with a verified account to use included AI. Browser workspaces have no personal time quota and sleep when idle.`,
          "The funding comes from a sponsored card that appears in the corner of the window at a cadence you control. That is the trade, stated plainly: an occasional advertisement instead of a monthly charge. Half of what the advertiser pays is credited to the developer who saw it, which is the part that makes the arrangement different from simply putting ads in a product.",
        ],
        points: [
          "No subscription or card required to start using the editor.",
          `Tagflow AI and other free included models share ${tokenAmount(FREE_WEEKLY_TOKENS)} tokens a week. Provider availability and context limits still apply.`,
          `Browser workspaces have no personal time quota and sleep when idle. Desktop projects run on your computer.`,
          `Optional included AI plans: ${PLAN_SUMMARY}. One-time token packs never expire.`,
          "Ads can be reduced or switched off entirely in settings; the earnings stop with them.",
        ],
      },
      {
        heading: "What the AI actually does",
        body: [
          "Start with included partner models from Tagflow AI and Heabsy, without finding or buying an API key. You can also connect your own provider key or, in the desktop app, a model running on your computer. Those options let you choose the model, spending and provider data policy.",
          "The assistant works in your project rather than beside it: it reads files, makes exact edits across several of them, runs your tests and type checks, and keeps going until the job is done. Every turn that changed files gets an Undo card, which is what makes it safe to let it act. For bigger jobs the Agents board runs several agents at once, each in its own copy of the project, and Race mode hands one task to two or three models so you keep the best attempt.",
          "The smaller help is there too: inline completion, select-and-rewrite with Ctrl+E, and plain-English compiler errors that turn a wall of template instantiation into a sentence. Nothing is sent to a provider unless you asked for something that requires it.",
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
          "Ad targeting uses a fixed vocabulary of 45 generic tags, such as `lang:rust` or `fw:react`, rather than your source code. AI requests and browser cloud workspaces are separate services; the privacy policy explains how they process project data.",
          "It does not run a marketplace with tens of thousands of extensions. If your work depends on a specific proprietary VS Code extension, that is a real reason to stay where you are, and the comparison page says so at more length.",
        ],
      },
    ],
    faq: [
      {
        q: "Is ADCode actually free, or free for a limited time?",
        a: `The editor is free with no subscription or trial expiry. Sponsored cards help fund it. Optional included AI plans (${PLAN_SUMMARY}) and token packs add more AI usage; they are not required to use the editor.`,
      },
      {
        q: "Do I need to pay for the AI features in ADCode?",
        a: `${includedAiSummary} Your own provider key is billed by that provider, and local desktop models use your computer.`,
      },
      {
        q: "What is the catch with a free AI code editor?",
        a: "The trade is an occasional sponsored card in the corner of the editor window. It never interrupts typing, debugging, or a running terminal command, it is rate limited, and it can be switched off in settings - though switching it off also stops the earnings, since the two are the same mechanism.",
      },
      {
        q: "Does a free code editor mean my code is the product?",
        a: "Ad targeting uses generic language and framework tags, rather than your source code, file paths or project names. AI requests and browser cloud workspaces process project data separately, as described in the privacy policy.",
      },
    ],
    related: ["online-ai-code-editor", "earn-while-you-code", "cursor"],
  },
  {
    slug: "online-ai-code-editor",
    title: "Free online AI code editor in your browser - ADCode",
    description:
      "Build with ADCode's AI agents in your browser. No download or API key required for included models. Learn about cloud workspaces, Git and free limits.",
    heading: "An online AI code editor, with nothing to install",
    lede:
      "ADCode runs in your browser at web.bluethenics.com. Describe what you want to build and AI agents work in a private cloud workspace, run commands and show a preview. Sign in to start with included partner models, without a download, API key or credit card.",
    updated: "2026-10-27",
    sections: [
      {
        heading: "From an idea to a running project",
        body: [
          "Open the browser app and sign in with Google, GitHub or email. Start a project and describe an app, a feature or a fix. The assistant can read and edit the project's files, run commands and tests, and use a preview to check the result.",
          "The browser app uses Vibe mode: a conversation about the project with the agent's work visible as it happens. It runs the project in a cloud workspace, so you can begin without installing an editor or setting up a local development environment.",
        ],
      },
      {
        heading: "The included AI and cloud time",
        body: [
          `${includedAiSummary} A verified account is required to use included AI.`,
          `Browser workspaces have no personal time quota. Workspaces sleep when idle, and shared service capacity can affect availability.`,
          "An occasional sponsored card helps fund the tools. Half of eligible ad revenue is credited to your account; earnings depend on eligible views and advertiser demand.",
        ],
      },
      {
        heading: "Keep your project connected with Git",
        body: [
          "Use GitHub to move work between the browser and desktop, or download the project and open it on your computer. Signing in with the same ADCode account keeps your earnings in one balance.",
          "Check the agent's edits and test results before publishing your project. The preview is a way to inspect work in progress; it is separate from deploying a finished public website.",
        ],
      },
      {
        heading: "When the desktop editor is a better fit",
        body: [
          "Choose the Windows or Linux desktop app when you want the full local code editor and terminal, local models, or a project that runs on your own computer without a cloud time allowance. The browser app is useful when you want to start in a tab with no installation.",
          "A native macOS desktop build is not published yet. The browser version provides a way to try ADCode without installing a desktop build.",
        ],
      },
    ],
    faq: [
      {
        q: "Can I use ADCode without downloading it?",
        a: "Yes. Open web.bluethenics.com and sign in to use ADCode's Vibe mode in a browser. AI agents work on your project in a private cloud workspace, with no editor installation required.",
      },
      {
        q: "Do I need an API key for the online AI code editor?",
        a: `${includedAiSummary} A verified account is required. Your own provider key follows that provider's billing.`,
      },
      {
        q: "How long can I use the free browser workspace?",
        a: `There is no personal cloud time quota. Workspaces sleep when idle and depend on shared service capacity. The Windows and Linux desktop app runs projects on your computer.`,
      },
      {
        q: "Can I move a browser project to the desktop app?",
        a: "Yes. Use GitHub to transfer the project, or download it and open it in the desktop app. Use the same ADCode account to keep your earnings in one balance.",
      },
    ],
    related: ["free-ai-code-editor", "earn-while-you-code", "vscode"],
  },
  {
    slug: "earn-while-you-code",
    title: "Get paid to code: how much an ad-supported editor pays",
    description:
      "An honest account of earning while you code in ADCode - the ad auction, the revenue share, the arithmetic on a real working month, and why it is not an income.",
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
    title: "ADCode vs VS Code: a free alternative, AI agents built in",
    description:
      "ADCode and VS Code share the Monaco editor. What ADCode adds - AI agents and full git in the box, and a share of ad revenue - and where VS Code still wins.",
    heading: "ADCode vs Visual Studio Code",
    lede: `Both editors are free and both are built on Monaco, so the editing feels familiar moving either way. The real differences are three: ADCode has AI agents and a full git workflow in the box rather than through extensions, ADCode pays you a share of its advertising revenue, and VS Code has an extension marketplace that ADCode cannot match.`,
    updated: "2026-10-17",
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
          them: "GitHub Copilot - a limited free tier with paid plans above it - or a third-party extension you configure.",
          us: `Built-in agents that edit files and run tests. ${includedAiSummary}`,
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
          us: "Ad targeting uses 45 generic tags, rather than source code, file paths or project names. AI and browser workspace processing are described separately in the privacy policy.",
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
    related: ["copilot", "cursor", "free-ai-code-editor"],
  },
  {
    slug: "cursor",
    title: "A free Cursor alternative with optional AI plans - ADCode",
    description:
      "Compare Cursor with ADCode's included AI credits, optional provider keys and ad revenue share. See the costs, model choices and where Cursor wins.",
    heading: "ADCode vs Cursor",
    lede: `Cursor is an AI-first editor with a limited free plan and a monthly subscription that bundles a model allowance. ADCode's editor is free, with optional included AI plans, and shares eligible ad revenue with you. ${includedAiSummary} This page explains the tradeoffs.`,
    updated: "2026-10-17",
    comparison: {
      subject: "Cursor",
      rows: [
        {
          aspect: "Price",
          them: "A free Hobby plan with limited usage, then a monthly subscription; teams pay per seat.",
          us: `Free editor; optional included AI plans: ${PLAN_SUMMARY}.`,
        },
        {
          aspect: "AI billing",
          them: "Bundled request allowance, then usage-based pricing above it.",
          us: includedAiSummary,
        },
        {
          aspect: "Model choice",
          them: "The models Cursor supports, on Cursor's routing.",
          us: "Four providers or any OpenAI-compatible endpoint, including a local model. Chosen per chat or per agent.",
        },
        {
          aspect: "Agents",
          them: "Mature. Codebase indexing and multi-file agentic edits are the product, tuned on a very large user base.",
          us: "Newer, and broad: agents edit across files, run your tests and keep going until done; several run at once on a board, and Race mode compares models on one task.",
        },
        {
          aspect: "Safety net",
          them: "Checkpoints to restore earlier states.",
          us: "An Undo card on every turn that changed files, and proof of work - the tests and checks each agent actually ran.",
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
        "Choose Cursor if its agent is already central to how you work and it is paying for itself. Cursor has had years to tune its codebase indexing and its agent against a very large user base, and that maturity shows in the edge cases; ADCode's agents do the same kinds of work but are newer. If the subscription saves you hours a week, it is doing its job and this is not the trade you should take. Stay, too, if your team has standardised on Cursor and switching would split its setup.",
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
          "Using your own key is optional; included partner models work without one. If you choose a personal provider account, paste its key in settings and select the model for your requests.",
          "The practical benefit is that the data policy is the one you agreed to with your provider, not a second one layered on top by an editor vendor - and if a provider raises prices or deprecates a model, you switch in settings rather than waiting for the editor to support the change.",
        ],
      },
      {
        heading: "Where Cursor is genuinely ahead",
        body: [
          "Maturity. Cursor has spent years tuning codebase indexing and its agent against a very large user base, and it shows in the edge cases - the odd monorepo, the refactor that touches forty files. ADCode's agents do the same kinds of work, and some things Cursor does not, such as racing several models on one task, but they are newer.",
          "If that agent is why you pay and it earns its keep, keep paying. A comparison page that told you otherwise would be selling something.",
        ],
      },
    ],
    faq: [
      {
        q: "Is there a free alternative to Cursor?",
        a: `ADCode is a free AI code editor with agents that edit files, run tests and work in parallel. ${includedAiSummary} It shares eligible ad revenue with you.`,
      },
      {
        q: "Does ADCode support the same models as Cursor?",
        a: "ADCode includes partner models through its credit allowance. You can also connect your own provider account or a local desktop model. Available models depend on the selected provider, so they may differ from Cursor's catalog.",
      },
      {
        q: "Why would I use an ad-supported editor instead of paying for Cursor?",
        a: "Because the cost runs the other way. Cursor charges a monthly subscription; ADCode credits you a share of what advertisers pay to reach you, and your AI spend goes straight to the provider at its own rates. If Cursor's agent already saves you hours each week, the subscription is worth it - the trade favours ADCode when you would rather pay only for the model calls you make.",
      },
    ],
    related: ["windsurf", "copilot", "free-ai-code-editor"],
  },
  {
    slug: "idlen",
    title: "ADCode vs Idlen: two ways to get paid while you code",
    description:
      "Both pay developers to see ads while coding. Idlen is a VS Code extension; ADCode is a complete editor with an auditable ledger. Which suits which situation.",
    heading: "ADCode vs Idlen",
    lede: `Idlen and ADCode share one idea - that a developer should be paid a share of the advertising revenue they generate - and differ in almost every decision after it. Idlen is an extension you add to the editor you already use. ADCode is the editor. That difference decides which one suits you, and it does not always decide in our favour.`,
    updated: "2026-10-17",
    comparison: {
      subject: "Idlen",
      rows: [
        {
          aspect: "What it is",
          them: "An extension for VS Code, Cursor, Devin Desktop and other VS Code builds.",
          us: "A complete desktop editor for Windows and Linux, with macOS on the way.",
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
          us: includedAiSummary,
        },
        {
          aspect: "Earnings record",
          them: "A balance in the extension.",
          us: "An append-only ledger, readable in the editor and on the web, with reversals rather than edits.",
        },
        {
          aspect: "Ad targeting data",
          them: "Reads package.json for relevance.",
          us: "Generic language and framework tags for ad targeting. AI requests and browser cloud workspaces process project data separately, as described in the privacy policy.",
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
          "ADCode is the larger ask. It is worth making if you also want its editor, included AI credits, optional provider keys, Git workflow and plain-English errors. If earnings are the only part you want, an extension inside your existing editor may be a better fit.",
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
  {
    slug: "windsurf",
    title: "ADCode vs Windsurf (now Devin Desktop): a free alternative",
    description:
      "Compare Windsurf, now Devin Desktop, with ADCode: included AI credits, optional provider keys and an ad-funded editor that shares revenue with you.",
    heading: "ADCode vs Windsurf, now Devin Desktop",
    lede: `Windsurf is now Devin Desktop. Cognition, which bought Windsurf in 2025, renamed the editor in June 2026: the IDE carries on, compatible with Windsurf and VS Code extensions, with an Agent Command Center in front of it and Devin Local in place of the Cascade agent. It is sold on plans with a usage allowance. ADCode's editor is free with optional included AI plans, and shares eligible ad revenue with you. ${includedAiSummary} This page says when each one is the right choice.`,
    updated: "2026-10-17",
    comparison: {
      subject: "Devin Desktop (formerly Windsurf)",
      rows: [
        {
          aspect: "Price",
          them: "A free plan with a light quota, and paid plans with a larger usage allowance.",
          us: `Free editor with no personal cloud time quota; optional included AI plans: ${PLAN_SUMMARY}.`,
        },
        {
          aspect: "AI billing",
          them: "An allowance that refreshes daily and weekly; what each message costs depends on the model and the size of the task.",
          us: includedAiSummary,
        },
        {
          aspect: "Model choice",
          them: "The models the plan offers.",
          us: "Four providers or any OpenAI-compatible endpoint, including a model on your own machine.",
        },
        {
          aspect: "Agents",
          them: "Devin Local, the successor to Cascade, alongside cloud Devin agents on a board called the Agent Command Center.",
          us: "Agents that edit across files, run your tests and keep going until done; several at once on a board, and Race mode to compare models on one task.",
        },
        {
          aspect: "Editing surface",
          them: "A full IDE, compatible with Windsurf and VS Code extensions and keybindings.",
          us: "Monaco - the editing component from VS Code - in a separate application.",
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
        "Choose Devin Desktop if you already work in Windsurf and its plan pays for itself - the rename carried plans, extensions and settings across, so staying costs you nothing. It is also the natural pick if you want local agents and Devin's cloud agents managed from one board. Stay, too, if your team has standardised on it: two editors in one team is a cost that never shows up on a pricing page.",
    },
    sections: [
      {
        heading: "Windsurf, renamed",
        body: [
          "On 2 June 2026 Cognition renamed Windsurf to Devin Desktop and shipped the change as an ordinary update, keeping each user's plan, extensions, keybindings and settings. The default screen became the Agent Command Center, a board of local and cloud agents, with the full editor behind it. Cascade, the agent Windsurf was known for, was retired on 1 July 2026 in favour of Devin Local.",
          "If the change is what sent you looking for a Windsurf alternative, the useful question is the one underneath it: whether you want your AI on a vendor's allowance, or on your own key.",
        ],
      },
      {
        heading: "An allowance against your own key",
        body: [
          "A plan's allowance is counted in a unit the vendor defines and can redefine. It bundles the model call, the vendor's margin and the vendor's view of what a request is worth, which makes a month's bill hard to predict and harder to compare.",
          "With your own key there is one price, the provider's, and one limit, your account's. If a provider cuts its prices you get the cut the same day; if a better model ships you switch in settings rather than waiting for an editor to offer it. Nothing about the arrangement depends on an editor vendor keeping its current plans.",
        ],
      },
      {
        heading: "What the agents do in ADCode",
        body: [
          "The assistant reads your project, makes exact edits across several files, runs your tests and type checks, and carries on until the job is done. Every turn that changed files gets an Undo card, so letting it act is safe rather than brave.",
          "For bigger jobs the Agents board runs several agents at once, each in its own copy of the project, and shows what each ran as proof of work - the tests and checks, with a tick or a cross. Race mode hands one task to two or three models and lets you keep the best attempt, which is the fastest way to find out which model suits your codebase.",
        ],
      },
      {
        heading: "Where Devin Desktop is genuinely ahead",
        body: [
          "Its link to Devin's cloud agents, and the time Cognition has spent tuning its agents against a large user base. Compatibility with VS Code extensions and keybindings also means more of an existing setup carries over unchanged, which some people value more than anything else on this page.",
        ],
      },
    ],
    faq: [
      {
        q: "What happened to Windsurf?",
        a: "Windsurf is now called Devin Desktop. Cognition renamed it on 2 June 2026 and delivered the change as an update, keeping users' plans, extensions and settings. The Cascade agent was retired on 1 July 2026 and replaced by Devin Local.",
      },
      {
        q: "Is there a free alternative to Windsurf?",
        a: `ADCode is a free AI code editor with agents that edit files, run tests and work in parallel. ${includedAiSummary} Each turn that changes files can be undone.`,
      },
      {
        q: "Can I use my own API key instead of a Windsurf or Devin plan?",
        a: "Yes. Connect your own provider key in ADCode to use that provider's models and billing. It is optional: included partner models use ADCode's free credit allowance without a personal API key.",
      },
      {
        q: "Is ADCode a fork of VS Code?",
        a: "No. ADCode is built on Monaco, the editing component VS Code uses, but it is a separate application rather than a fork of the VS Code shell. Editing and keybindings feel familiar; the surrounding workbench is ADCode's own.",
      },
    ],
    related: ["cursor", "copilot", "free-ai-code-editor"],
  },
  {
    slug: "copilot",
    title: "ADCode vs GitHub Copilot: a free Copilot alternative",
    description:
      "Compare GitHub Copilot with ADCode: a free editor with included AI, optional included AI plans and provider keys, plus a share of eligible ad revenue.",
    heading: "ADCode vs GitHub Copilot",
    lede: `GitHub Copilot is an AI assistant you add to an editor you already use, with a free tier that has monthly limits and paid plans above it. ADCode is a free editor with optional included AI plans and a share of eligible ad revenue credited to you. ${includedAiSummary} The first keeps your existing editor; the second offers an integrated alternative.`,
    updated: "2026-10-17",
    comparison: {
      subject: "GitHub Copilot",
      rows: [
        {
          aspect: "What it is",
          them: "An AI assistant for VS Code, Visual Studio, JetBrains IDEs and other editors.",
          us: "A complete desktop editor with the AI built in.",
        },
        {
          aspect: "Price",
          them: "A free tier with monthly limits, and paid individual and business plans above it.",
          us: `Free editor; optional included AI plans: ${PLAN_SUMMARY}.`,
        },
        {
          aspect: "AI billing",
          them: "Included in the plan, with limits that depend on the plan.",
          us: includedAiSummary,
        },
        {
          aspect: "Model choice",
          them: "The models GitHub offers on your plan.",
          us: "Four providers or any OpenAI-compatible endpoint, including a model on your own machine.",
        },
        {
          aspect: "Agents",
          them: "Agent mode in the editor, and a coding agent that works on GitHub issues and opens pull requests.",
          us: "Agents that edit across files and run your tests; several at once on a board, with proof of work, and Race mode to compare models.",
        },
        {
          aspect: "Keeping your editor",
          them: "Yes - that is the point of it.",
          us: "No. Moving editors is a real cost, and it belongs on this side of the table.",
        },
        {
          aspect: "Earnings",
          them: "None.",
          us: `About ${perImpression} per impression, credited on an append-only ledger.`,
        },
      ],
      whenNotUs:
        "Keep Copilot if you are not willing to change editors - particularly if you live in a JetBrains IDE or Visual Studio, which ADCode does not replace - or if your organisation runs on GitHub and values the coding agent that picks up issues and opens pull requests inside that workflow. A plan your employer pays for is also hard to beat on price.",
    },
    sections: [
      {
        heading: "An assistant, or an editor",
        body: [
          "Copilot's great strength is that it goes where you already are. It does not ask you to move, and for most people that is the right-sized change.",
          "ADCode asks you to move editors. Consider it if you want included AI credits, optional provider keys, agents that work in parallel, Git history and integrated terminals. Check the credit and cloud time allowances when choosing between the browser and desktop versions.",
        ],
      },
      {
        heading: "Limits, and who sets them",
        body: [
          "A plan's allowance is set by the vendor and changes when the vendor decides. With your own key the only limits are your provider account's, and you can raise them yourself. Heavy agent use on a plan tends to meet its ceiling; heavy use on your own key meets only your budget, which you can see request by request.",
        ],
      },
      {
        heading: "Where Copilot is genuinely ahead",
        body: [
          "Reach and integration. It runs in more editors than any other assistant, and its coding agent lives inside GitHub itself - an issue goes in, a pull request comes out. If that loop is how your team works, nothing in an editor replaces it.",
        ],
      },
    ],
    faq: [
      {
        q: "Is there a free alternative to GitHub Copilot?",
        a: `Copilot has a limited free tier. ADCode is a free editor with AI agents built in and optional included AI plans. ${includedAiSummary} The editor also credits you a share of eligible ad revenue.`,
      },
      {
        q: "Can I use GitHub Copilot inside ADCode?",
        a: "ADCode has its own AI assistant, with included partner models and optional personal provider keys. It does not consume a Copilot subscription. You can keep Copilot in your existing editor and try ADCode alongside it.",
      },
      {
        q: "Does ADCode work with any model, like Copilot's model picker?",
        a: "ADCode connects directly to four providers and to any OpenAI-compatible endpoint, including a model running on your own machine. You choose the model per chat or per agent, and Race mode can give one task to two or three models at once so you keep the best result.",
      },
    ],
    related: ["cursor", "windsurf", "vscode"],
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
  return pageMetadata({
    path: landingPath(page),
    title: { absolute: page.title },
    description: page.description,
    type: "article",
    publishedTime: page.updated,
    modifiedTime: page.updated,
  });
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
