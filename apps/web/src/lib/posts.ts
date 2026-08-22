/**
 * Blog posts.
 *
 * Two sources, in order: the API, where the admin panel writes them, and a small set of
 * files in this repo as a fallback.
 *
 * The fallback is not a hedge - it is what keeps the marketing site standing when the
 * API is down or not yet deployed. A blog that 500s because a backend is unreachable is
 * worse than one showing three slightly old posts, and search engines punish the former
 * far more than the latter.
 *
 * Reads are revalidated rather than cached forever, so publishing from the admin panel
 * appears without a deploy.
 */
import { API_ORIGIN } from "./site";

export interface Post {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated?: string;
  readingMinutes: number;
  body: string;
}

interface PostSource {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated?: string;
  body: string;
}

/** How long a published post may be stale on the public site. */
const REVALIDATE_SECONDS = 60;

const SOURCES: readonly PostSource[] = [
  {
    slug: "why-the-ledger-is-append-only",
    title: "Why the ledger is append-only",
    description:
      "An administrator who can edit a balance is an administrator who can steal from you. Here is how ADCode makes that structurally impossible rather than merely discouraged.",
    published: "2026-08-18",
    body: `
Most systems that owe you money store a number and update it. A credit arrives, the number goes up. A correction arrives, the number goes down. The number is the truth, and the history — if there is one — is a log written alongside it, for support staff to read when someone complains.

That design has a problem nobody likes to say out loud: **the person running the system can change what you are owed, and the only record of the change is one they also control.**

## What ADCode does instead

Every event that moves money is a row. Rows are never updated and never deleted.

- An ad you viewed writes an \`impression\` row with the exact amount.
- A clawback writes a \`reversal\` row that points at the row it reverses.
- An administrative correction writes an \`adjustment\` row carrying a reason and the identity of the administrator who made it.

Your balance is not stored as an authority. It is a fold over your rows — add them up and that is what you have. There is a cached copy for speed, and when the cache and the rows disagree, **the rows win** and the cache is rebuilt.

## Why reversals instead of edits

If a credit turns out to be fraudulent, the obvious fix is to delete it. We do not, because a deleted row is indistinguishable from a row that never existed, and that is precisely the ambiguity a person disputing their balance cannot resolve.

Instead you see both rows: the original credit, and the reversal that took it back, with the reversal naming what it reversed. You can disagree with the reversal. You cannot be confused about whether it happened.

## The part that makes it real

None of this matters if there is a back door. So there is no operation in the system that edits a ledger row — not in the API, not in the admin panel, not for anyone. The absence of the feature is the guarantee.

And because administrators can still *read* your history, every administrative read of another person's ledger writes its own audit row: who looked, at whom, when.

## What you can check yourself

Open the earnings view in the editor, or the dashboard on the web. The rows you see are the rows the system has. The description you read — \`Ad from Vercel, 4.2s\` — is generated once, on the server, and shown identically to you and to us. There is no internal view with different numbers in it.
`,
  },
  {
    slug: "what-an-ad-supported-editor-owes-you",
    title: "What an ad-supported editor owes you",
    description:
      "Four commitments ADCode makes about when ads appear, what leaves your machine, and what you get paid — and how each one is enforced rather than promised.",
    published: "2026-08-18",
    body: `
"Ad-supported" has earned its reputation. It usually means the product is worse on purpose, and that the thing being sold is you.

We think an ad-supported editor is defensible, but only if it commits to a few things and then actually enforces them. Here is what ADCode commits to.

## 1. Ads never interrupt work

A sponsored card appears in the corner of the window. It does not appear while you are typing, during a debug session, while a terminal command is running, or when the window is not focused.

That last one matters more than it sounds: an ad shown to an unfocused window is one nobody saw, so paying for it would be fraud against the advertiser and showing it would be noise for you. It is simply not served.

These rules are evaluated in a fixed order in the editor's scheduler. They are not preferences we hope to honour.

## 2. Your code stays on your machine

Targeting uses a closed list of 45 generic tags — the language and framework currently open. \`lang:rust\`. \`fw:react\`. \`tool:docker\`. That is the entire vocabulary, and it cannot be extended by a server response.

File contents, file paths, and project names never leave the machine. Not hashed, not truncated, not "anonymised". They are never sent.

## 3. You get a real share, stated plainly

Advertisers pay a $8.00 CPM. You get 50% of it — **$0.004000** per card viewed — credited to your ledger the moment the receipt is verified.

At the default cadence of four cards an hour, that is about **$0.016** for an hour of active editing.

We would rather print that number than let you discover it. ADCode is a way to use a capable editor for free with some money coming back. It is not a way to earn a living, and any product in this category telling you otherwise is doing arithmetic it hopes you will not repeat.

## 4. You can turn it down, or off

Cadence is a setting: off, light, standard, or max. Off means no ads and no earnings, and the editor is otherwise identical — no nag screens, no reduced features, no countdown to a paywall.

The server can make the limits *stricter* than your setting. It can never make them looser. A compromised or misconfigured server cannot be used to flood you with ads, because the client refuses any configuration more permissive than the one it shipped with.
`,
  },
  {
    slug: "how-targeting-works-without-reading-your-code",
    title: "How targeting works without reading your code",
    description:
      "Advertisers want to reach Rust developers. ADCode makes that possible with 45 tags and nothing else — no file contents, no paths, no project names.",
    published: "2026-08-18",
    body: `
An advertiser selling a Postgres product wants to reach people writing backend code, not people writing shaders. That is a reasonable thing to want, and serving it badly is how ad systems end up reading everything.

## The whole vocabulary

ADCode's editor derives tags from what you have open, drawn from a fixed list of 45:

- **Languages** — \`lang:rust\`, \`lang:typescript\`, \`lang:python\`, and 18 more.
- **Frameworks** — \`fw:react\`, \`fw:django\`, \`fw:rails\`, and 8 more.
- **Tools** — \`tool:docker\`, \`tool:cargo\`, \`tool:terraform\`, and 6 more.
- **Platforms** — \`platform:web\`, \`platform:backend\`, \`platform:mobile\`, \`platform:desktop\`.

That is the complete list. It is compiled into the editor, and the server cannot add to it. A tag the server does not recognise is dropped; a tag the *client* does not recognise was never sent.

## What the server receives

A request for an ad contains the tags, whether your theme is light or dark, and how many cards to return. That is all of it.

It does not contain a filename. It does not contain a repository name. It does not contain a line of code, a symbol, an error message, or a commit. There is no field in the request where those could be put.

## Why this is enough

An advertiser targeting \`lang:rust\` reaches people with Rust open. That is a better signal than most ad networks manage from far more invasive collection, because it is *current* — not inferred from browsing history six weeks ago.

The trade-off is that targeting cannot get more specific than the vocabulary allows. An advertiser cannot reach "people whose tests are failing" or "people working on a payments service". We think that ceiling is a feature.

## Verification, not trust

The other half of the system is that an advertiser only pays for a card that was really served and really seen. Every serve writes a record; a receipt that does not match one earns nothing and bills nobody.

That protects the advertiser from paying for fabricated views, and it protects you, because it means the system has no incentive to serve ads it cannot verify.
`,
  },
];

/** Roughly 220 words a minute, rounded up, minimum one. */
function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

function hydrate(source: PostSource): Post {
  const post: Post = {
    slug: source.slug,
    title: source.title,
    description: source.description,
    published: source.published,
    readingMinutes: readingMinutes(source.body),
    body: source.body,
  };
  return source.updated === undefined ? post : { ...post, updated: source.updated };
}

/** What the API returns. Timestamps are millisecond epochs there, ISO dates here. */
interface ApiPost {
  slug: string;
  title: string;
  description: string;
  body: string;
  publishedAt: number | null;
  updatedAt: number;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function fromApi(post: ApiPost): Post {
  const published = isoDay(post.publishedAt ?? post.updatedAt);
  const updated = isoDay(post.updatedAt);

  const hydrated: Post = {
    slug: post.slug,
    title: post.title,
    description: post.description,
    published,
    readingMinutes: readingMinutes(post.body),
    body: post.body,
  };

  return updated === published ? hydrated : { ...hydrated, updated };
}

const fileposts = (): Post[] =>
  SOURCES.map(hydrate).sort((a, b) => b.published.localeCompare(a.published));

/** Newest first. Falls back to the bundled posts when the API cannot be reached. */
export async function allPosts(): Promise<Post[]> {
  try {
    const response = await fetch(`${API_ORIGIN}/v1/posts`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return fileposts();

    const body = (await response.json()) as { posts?: ApiPost[] };
    const posts = Array.isArray(body.posts) ? body.posts.map(fromApi) : [];

    // An API that is up but has no posts yet still shows the bundled ones, so a fresh
    // deployment never has an empty blog.
    return posts.length === 0 ? fileposts() : posts.sort((a, b) => b.published.localeCompare(a.published));
  } catch {
    return fileposts();
  }
}

export async function getPost(slug: string): Promise<Post | null> {
  try {
    const response = await fetch(`${API_ORIGIN}/v1/posts/${encodeURIComponent(slug)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (response.ok) return fromApi((await response.json()) as ApiPost);
  } catch {
    // Fall through to the bundled posts.
  }

  const found = SOURCES.find((p) => p.slug === slug);
  return found === undefined ? null : hydrate(found);
}
