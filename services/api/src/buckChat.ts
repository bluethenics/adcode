/**
 * Buck, the website's mascot, answering short questions about ADCode through Tagflow AI.
 *
 * The browser never holds a key: it posts a question to /v1/ai/buck, and this Worker asks one of
 * Tagflow's sponsored (free) models with the server's TAGFLOW_API_KEY. Anyone may ask, signed in
 * or not, so the cost is capped twice - per visitor and per day for the whole site - and every
 * failure falls back to a built-in answer instead of an error, because a mascot that says
 * "502" is worse than one that says less.
 *
 * Every fact Buck may state comes from the same tables the pricing page renders, so a reply can
 * never quote a price the page does not show. The prompt forbids invented numbers, discounts,
 * testimonials and user counts, and never mentions markup or margin.
 */
import { PLANS, PLANS_ON_SALE } from "./aiPlans.ts";
import { CREDIT_UNITS, creditAmount } from "./aiEconomics.ts";
import { COST_PAID_CONFIG } from "./paidTokens.ts";
import { WALLET_CUSTOM_MAX_CENTS, WALLET_CUSTOM_MIN_CENTS } from "./modelWallet.ts";

export const BUCK_MESSAGE_MAX = 400;
export const BUCK_HISTORY_MAX = 6;
/** Questions one visitor may ask in ten minutes, and the whole site in a day. */
export const BUCK_VISITOR_LIMIT = 12;
export const BUCK_VISITOR_WINDOW_MS = 10 * 60_000;
export const BUCK_DAILY_LIMIT = 5_000;
export const BUCK_REPLY_MAX_TOKENS = 260;
const PAGES = ["home", "pricing", "credits", "docs", "download", "other"] as const;
export type BuckPage = typeof PAGES[number];

export interface BuckTurn { role: "user" | "assistant"; content: string }
export interface BuckRequest { message: string; page: BuckPage; history: BuckTurn[] }

const text = (raw: unknown, max: number): string | null => {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  return value.length > 0 && value.length <= max ? value : null;
};

/** Null for anything but a short question, an optional known page and up to six short turns. */
export function parseBuckRequest(raw: unknown): BuckRequest | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["message", "page", "history"].includes(key))) return null;
  const message = text(body["message"], BUCK_MESSAGE_MAX);
  if (message === null) return null;
  const page = body["page"] === undefined ? "other" : PAGES.includes(body["page"] as BuckPage) ? body["page"] as BuckPage : null;
  if (page === null) return null;
  const history: BuckTurn[] = [];
  if (body["history"] !== undefined) {
    if (!Array.isArray(body["history"]) || body["history"].length > BUCK_HISTORY_MAX) return null;
    for (const turn of body["history"]) {
      if (typeof turn !== "object" || turn === null) return null;
      const { role, content } = turn as Record<string, unknown>;
      const said = text(content, BUCK_MESSAGE_MAX * 2);
      if ((role !== "user" && role !== "assistant") || said === null) return null;
      history.push({ role, content: said });
    }
  }
  return { message, page, history };
}

const dollars = (cents: number): string => `$${(cents / 100).toLocaleString("en-US")}`;

/** The facts Buck may use, built from the plan and wallet tables. */
export function buckFacts(): string {
  const plans = PLANS_ON_SALE.map((plan) => {
    const yearly = plan.yearlyCents === undefined ? "" : ` or ${dollars(plan.yearlyCents)} a year (two months free)`;
    return `- ${plan.name}: ${dollars(plan.priceCents)} a month${yearly}; ${creditAmount(plan.weeklyTokens)} credits every day, every hosted model including premium ones${plan.id === "pro" ? "; the plan most people should start with" : ""}${plan.id === "max" ? "; the biggest allowance, for building all day" : ""}.`;
  });
  return [
    "ADCode is a free, AI-native code editor for Windows, macOS and Linux, funded by sponsored cards.",
    `Free: the editor costs nothing, and Tagflow AI's sponsored models are free for every signed-in account (${creditAmount(COST_PAID_CONFIG.freeWeeklyTokens)} free credits a day on included models).`,
    ...(plans.length > 0 ? ["Plans (cancel any time in the billing portal; access lasts to the end of the paid period):", ...plans] : ["No plans are on sale right now."]),
    `Credits: USD credits pay for any model at its listed price. Buy any whole-dollar amount from ${dollars(WALLET_CUSTOM_MIN_CENTS)} to ${dollars(WALLET_CUSTOM_MAX_CENTS)}, once; they never expire and nothing renews.`,
    `A credit in a plan is a thousandth of a dollar of model use; ${CREDIT_UNITS.toLocaleString("en-US")} units each.`,
    "Payments and invoices go through Dodo Payments; tax is shown before paying.",
    "Pages: /pricing (plans and credits), /ai-tokens (balance, buy credits, manage plan), /versions (download), /docs (guides), /support (help).",
  ].join("\n");
}

export function buckSystemPrompt(page: BuckPage): string {
  return [
    "You are Buck, ADCode's mascot: a cheerful gold coin with a terminal face. You speak on ADCode's website.",
    `The visitor is on the ${page} page.`,
    "Answer in at most three short sentences (under 60 words), friendly and plain. No markdown headings or lists; a page path like /pricing is fine.",
    "Use only the facts below. If the answer is not in them, say you are not sure and point to /support or /docs.",
    "Never invent prices, discounts, deadlines, testimonials, user numbers or features. Never pressure or rush anyone; there is no countdown and no limited stock.",
    "Never discuss how ADCode makes money on models, its costs, markup or margins.",
    "If asked which plan to choose: Builder for evenings and side projects, Pro for coding every day, Max for building all day; credits for occasional use. Free is fine to start.",
    "Do not write code or help with anything unrelated to ADCode; say you are only the pricing and product helper.",
    "Facts:",
    buckFacts(),
  ].join("\n");
}

/** A reply from Buck's own knowledge, for when Tagflow is unavailable or a cap is reached. */
export function buckFallback(message: string): string {
  const q = message.toLowerCase();
  const plans = PLANS_ON_SALE;
  const pro = plans.find((plan) => plan.id === "pro");
  if (/(refund|cancel|portal|invoice)/.test(q)) return "You can cancel any plan in the billing portal from AI credits, and it keeps working until the period you paid for ends. For a refund question, the team at /support will help.";
  if (/(custom|amount|credit|top.?up|wallet|pay as you go|payg)/.test(q)) return `Credits are US dollars you add once: any whole amount from ${dollars(WALLET_CUSTOM_MIN_CENTS)} to ${dollars(WALLET_CUSTOM_MAX_CENTS)}. They never expire and pay for any model at its listed price. Add them at /ai-tokens.`;
  if (/(year|annual)/.test(q) && pro?.yearlyCents !== undefined) return `Paying yearly gives you two months free: Pro is ${dollars(pro.yearlyCents)} a year instead of ${dollars(pro.priceCents * 12)}. Same daily credits, one payment.`;
  if (/(which|best|recommend|choose|should i)/.test(q)) return "Builder suits evenings and side projects, Pro is for coding every day, and Max is for building all day. Not sure yet? Start free and add a plan when you hit the limit.";
  if (/(price|cost|plan|how much|pro|max|builder)/.test(q) && plans.length > 0) return `${plans.map((plan) => `${plan.name} is ${dollars(plan.priceCents)} a month for ${creditAmount(plan.weeklyTokens)} credits a day`).join(", ")}. Every plan covers every hosted model. The editor and Tagflow AI stay free.`;
  if (/(free|trial)/.test(q)) return "The editor is free and Tagflow AI's sponsored models are free for every signed-in account. No card needed. Download it at /versions.";
  return "I'm Buck! Ask me about plans, credits or what's free in ADCode. For anything else, /docs and /support have the answers.";
}

/** The model's text, without a reasoning block, trimmed to a mascot-sized reply; null when unusable. */
export function buckReplyText(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const choices = (raw as { choices?: unknown }).choices;
  const first = Array.isArray(choices) ? choices[0] as { message?: { content?: unknown } } | undefined : undefined;
  const content = first?.message?.content;
  if (typeof content !== "string") return null;
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "").replace(/^#+\s*/gm, "").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length <= 600 ? cleaned : `${cleaned.slice(0, 597).replace(/\s+\S*$/, "")}…`;
}

/** Messages sent to Tagflow: the system prompt, the visitor's short history, and the question. */
export function buckMessages(request: BuckRequest): { role: "system" | "user" | "assistant"; content: string }[] {
  return [{ role: "system", content: buckSystemPrompt(request.page) }, ...request.history, { role: "user", content: request.message }];
}

/** Visitors are counted by a short hash of their address, never the address itself. */
export async function visitorKey(address: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`buck:${address}`));
  return `buck:${[...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

