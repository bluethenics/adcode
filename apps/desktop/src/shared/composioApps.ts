/**
 * Apps the assistant can reach through Composio, for the Plugins page's Apps tab.
 *
 * Composio runs one MCP server (`COMPOSIO_ENDPOINT`) that fronts several hundred services.
 * ADCode signs in to it once, in the browser; each app is then linked to the person's
 * Composio account the first time it is used, on Composio's own consent page. No key or
 * password for any of these apps ever passes through ADCode.
 *
 * This list is the well-known subset, by Composio's toolkit slug - the same slug its logo
 * service and its tools use. Composio's full catalogue is only readable signed in, so a
 * service missing here can still be linked by name: the Apps tab offers whatever was typed.
 */
export const COMPOSIO_CONNECTOR_ID = "composio";
export const COMPOSIO_ENDPOINT = "https://connect.composio.dev/mcp";
export const COMPOSIO_HOMEPAGE = "https://composio.dev";

export type ComposioCategory = "Email and calendar" | "Code and deploy" | "Data" | "Docs and files" | "Chat" | "Projects" | "Design" | "Sales and support" | "Payments" | "Social and media";

export interface ComposioApp {
  /** Composio's toolkit slug. */
  readonly slug: string;
  readonly name: string;
  readonly category: ComposioCategory;
  /** What the assistant can do with it, in a few plain words. */
  readonly does: string;
}

const app = (slug: string, name: string, category: ComposioCategory, does: string): ComposioApp => ({ slug, name, category, does });

export const COMPOSIO_APPS: readonly ComposioApp[] = [
  app("gmail", "Gmail", "Email and calendar", "Read, search, draft and send email."),
  app("googlecalendar", "Google Calendar", "Email and calendar", "Find free time and create or move events."),
  app("outlook", "Outlook", "Email and calendar", "Read and send mail, manage the calendar."),
  app("calendly", "Calendly", "Email and calendar", "List bookings and share scheduling links."),
  app("cal", "Cal.com", "Email and calendar", "Create and manage bookings."),
  app("zoom", "Zoom", "Email and calendar", "Schedule meetings and fetch recordings."),
  app("googlemeet", "Google Meet", "Email and calendar", "Create meeting links and read details."),

  app("github", "GitHub", "Code and deploy", "Open issues and pull requests, read repos, review code."),
  app("gitlab", "GitLab", "Code and deploy", "Manage merge requests, issues and pipelines."),
  app("bitbucket", "Bitbucket", "Code and deploy", "Work with repositories and pull requests."),
  app("cloudflare", "Cloudflare", "Code and deploy", "Manage DNS, Workers, Pages and zones."),
  app("vercel", "Vercel", "Code and deploy", "Deploy projects and read build logs."),
  app("netlify", "Netlify", "Code and deploy", "Deploy sites and manage their settings."),
  app("render", "Render", "Code and deploy", "Manage services and deploys."),
  app("heroku", "Heroku", "Code and deploy", "Manage apps, dynos and config."),
  app("digital_ocean", "DigitalOcean", "Code and deploy", "Manage droplets, apps and databases."),
  app("sentry", "Sentry", "Code and deploy", "Read errors and resolve issues."),
  app("datadog", "Datadog", "Code and deploy", "Query metrics, monitors and logs."),
  app("posthog", "PostHog", "Code and deploy", "Query product analytics and feature flags."),
  app("docker_hub", "Docker Hub", "Code and deploy", "Look up images and repositories."),

  app("supabase", "Supabase", "Data", "Run SQL, manage tables, auth and storage."),
  app("firebase", "Firebase", "Data", "Read and write Firestore and manage projects."),
  app("neon", "Neon", "Data", "Create Postgres branches and run queries."),
  app("mongodb", "MongoDB", "Data", "Query and update collections."),
  app("airtable", "Airtable", "Data", "Read and update bases and records."),
  app("googlesheets", "Google Sheets", "Data", "Read, write and format spreadsheets."),
  app("snowflake", "Snowflake", "Data", "Run queries against the warehouse."),
  app("googlebigquery", "BigQuery", "Data", "Run SQL over datasets."),
  app("pinecone", "Pinecone", "Data", "Upsert and query vector indexes."),

  app("notion", "Notion", "Docs and files", "Search, read and write pages and databases."),
  app("googledocs", "Google Docs", "Docs and files", "Create and edit documents."),
  app("googledrive", "Google Drive", "Docs and files", "Find, read and upload files."),
  app("googleslides", "Google Slides", "Docs and files", "Build and edit presentations."),
  app("dropbox", "Dropbox", "Docs and files", "Find, read and upload files."),
  app("one_drive", "OneDrive", "Docs and files", "Find, read and upload files."),
  app("box", "Box", "Docs and files", "Search and manage files and folders."),
  app("confluence", "Confluence", "Docs and files", "Search and edit wiki pages."),
  app("coda", "Coda", "Docs and files", "Read and update docs and tables."),

  app("slack", "Slack", "Chat", "Read channels, post messages, search history."),
  app("discord", "Discord", "Chat", "Read and send messages in servers."),
  app("microsoft_teams", "Microsoft Teams", "Chat", "Post to channels and chats."),
  app("telegram", "Telegram", "Chat", "Send and read bot messages."),
  app("whatsapp", "WhatsApp", "Chat", "Send business messages and templates."),
  app("twilio", "Twilio", "Chat", "Send SMS and place calls."),

  app("linear", "Linear", "Projects", "Create, triage and update issues."),
  app("jira", "Jira", "Projects", "Search, create and move tickets."),
  app("asana", "Asana", "Projects", "Create and update tasks and projects."),
  app("trello", "Trello", "Projects", "Manage boards, lists and cards."),
  app("clickup", "ClickUp", "Projects", "Manage tasks, lists and docs."),
  app("monday", "monday.com", "Projects", "Update boards and items."),
  app("todoist", "Todoist", "Projects", "Add and complete tasks."),
  app("googletasks", "Google Tasks", "Projects", "Add and complete tasks."),

  app("figma", "Figma", "Design", "Read files, frames and comments."),
  app("canva", "Canva", "Design", "Create and export designs."),
  app("miro", "Miro", "Design", "Read and add to boards."),
  app("webflow", "Webflow", "Design", "Manage sites, collections and items."),

  app("hubspot", "HubSpot", "Sales and support", "Manage contacts, deals and tickets."),
  app("salesforce", "Salesforce", "Sales and support", "Query and update CRM records."),
  app("pipedrive", "Pipedrive", "Sales and support", "Manage deals and contacts."),
  app("intercom", "Intercom", "Sales and support", "Read and answer conversations."),
  app("zendesk", "Zendesk", "Sales and support", "Search and update tickets."),
  app("freshdesk", "Freshdesk", "Sales and support", "Search and update tickets."),
  app("mailchimp", "Mailchimp", "Sales and support", "Manage audiences and campaigns."),
  app("sendgrid", "SendGrid", "Sales and support", "Send transactional email."),
  app("resend", "Resend", "Sales and support", "Send transactional email."),
  app("typeform", "Typeform", "Sales and support", "Read forms and responses."),

  app("stripe", "Stripe", "Payments", "Look up customers, payments and subscriptions."),
  app("shopify", "Shopify", "Payments", "Manage products, orders and customers."),
  app("paypal", "PayPal", "Payments", "Read transactions and invoices."),
  app("quickbooks", "QuickBooks", "Payments", "Read invoices, customers and reports."),
  app("xero", "Xero", "Payments", "Read invoices, contacts and reports."),

  app("youtube", "YouTube", "Social and media", "Search videos and read channel data."),
  app("twitter", "X (Twitter)", "Social and media", "Read and post."),
  app("linkedin", "LinkedIn", "Social and media", "Share posts and read your profile."),
  app("reddit", "Reddit", "Social and media", "Search and read posts and comments."),
  app("spotify", "Spotify", "Social and media", "Search music and manage playlists."),
  app("elevenlabs", "ElevenLabs", "Social and media", "Generate speech from text."),
];

export const COMPOSIO_CATEGORIES: readonly ComposioCategory[] = [...new Set(COMPOSIO_APPS.map((item) => item.category))];

/** Composio's own logo service: one SVG per toolkit slug, no key. */
export function composioLogoUrl(slug: string): string {
  return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;
}

/** A typed name as a toolkit slug, or null when it could not be one. */
export function composioSlug(value: string): string | null {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug.length >= 2 && slug.length <= 48 ? slug : null;
}

/** Apps matching the words typed, across name, slug, category and what it does. */
export function searchComposioApps(query: string, category: ComposioCategory | null = null): readonly ComposioApp[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return COMPOSIO_APPS.filter((item) => {
    if (category !== null && item.category !== category) return false;
    const haystack = `${item.name} ${item.slug} ${item.category} ${item.does}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** What the chat is asked, so the assistant links one app on the person's Composio account. */
export function composioLinkPrompt(name: string, slug: string): string {
  return `Connect my ${name} account through the Composio connector (toolkit "${slug}"). Use its connection tool to start the sign-in, give me the link to approve, and tell me when ${name} is ready to use.`;
}
