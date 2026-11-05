/**
 * Applications from AI model providers who want their models offered inside ADCode - free to
 * users and sponsored, sold as credits through ADCode, or listed for people's own keys.
 *
 * One public form, no account needed: a provider should be able to apply in a minute. The
 * request is same-origin only, rate limited and honeypotted; the team reviews applications in
 * the admin Models section and sets each one's status.
 */

export const PROVIDER_OFFERS = ["free", "paid", "byok"] as const;
export type ProviderOffer = (typeof PROVIDER_OFFERS)[number];
export const APPLICATION_STATUSES = ["new", "contacted", "accepted", "declined"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ProviderApplicationInput {
  readonly company: string;
  readonly contactName: string;
  readonly email: string;
  readonly website: string;
  readonly models: readonly string[];
  readonly apiBase: string;
  readonly offers: readonly ProviderOffer[];
  readonly pricing: string;
  readonly message: string;
}

export interface ProviderApplication extends ProviderApplicationInput {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly receivedAt: number;
  readonly note: string;
}

export interface ProviderApplicationStore {
  add(application: ProviderApplication): Promise<void>;
  list(limit: number): Promise<ProviderApplication[]>;
  setStatus(id: string, status: ApplicationStatus, note: string): Promise<boolean>;
}

const KEYS = new Set(["company", "contactName", "email", "website", "models", "apiBase", "offers", "pricing", "message", "url2"]);

const clean = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : null;

const httpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") && value.length <= 300;
  } catch {
    return false;
  }
};

export type ParsedApplication = { readonly ok: true; readonly value: ProviderApplicationInput } | { readonly ok: false; readonly error: string; readonly bot?: true };

/** A form submission, or the first thing wrong with it in words the form can show. */
export function parseProviderApplication(raw: unknown): ParsedApplication {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "The form did not arrive. Try again." };
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !KEYS.has(key))) return { ok: false, error: "The form did not arrive. Try again." };
  // The hidden field people never see: anything in it was filled by a script.
  if (typeof value["url2"] === "string" && value["url2"] !== "") return { ok: false, error: "spam", bot: true };
  const company = clean(value["company"], 120), contactName = clean(value["contactName"], 120), email = clean(value["email"], 254);
  const website = clean(value["website"], 300), apiBase = clean(value["apiBase"] ?? "", 300), pricing = clean(value["pricing"] ?? "", 300), message = clean(value["message"] ?? "", 2000);
  if (!company) return { ok: false, error: "Add your company name." };
  if (!contactName) return { ok: false, error: "Add your name." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Add a work email we can reply to." };
  if (!website || !httpsUrl(website)) return { ok: false, error: "Add your website, starting with https://." };
  if (apiBase === null || (apiBase !== "" && !httpsUrl(apiBase))) return { ok: false, error: "The API address must start with https://, or leave it empty." };
  const modelsRaw = clean(value["models"], 2000);
  const models = (modelsRaw ?? "").split(/[\n,]/).map((model) => model.trim()).filter(Boolean);
  if (models.length === 0) return { ok: false, error: "List at least one model, one per line." };
  if (models.length > 30 || models.some((model) => model.length > 120)) return { ok: false, error: "List up to 30 models, each under 120 characters." };
  const offersRaw = value["offers"];
  if (!Array.isArray(offersRaw) || offersRaw.length === 0) return { ok: false, error: "Choose at least one way ADCode could offer your models." };
  if (offersRaw.some((offer) => !(PROVIDER_OFFERS as readonly unknown[]).includes(offer))) return { ok: false, error: "The form did not arrive. Try again." };
  return {
    ok: true,
    value: { company, contactName, email: email.toLowerCase(), website, models, apiBase: apiBase ?? "", offers: [...new Set(offersRaw as ProviderOffer[])], pricing: pricing ?? "", message: message ?? "" },
  };
}

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}
