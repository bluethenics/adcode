import { DurableObject } from "cloudflare:workers";
import { verifyIdToken } from "../../cloud/src/auth.ts";

export interface ProjectEnv {
  PROJECTS: DurableObjectNamespace<CloudProject>;
  PROJECT_ACCOUNTS: DurableObjectNamespace<ProjectAccount>;
  ACCOUNT_API: Fetcher;
  FIREBASE_PROJECT_ID: string;
}
type Summary = { id: string; name: string; owner: string };
type Meta = Summary & { invite: string; revision: number; members: Record<string, string> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const projectPath = (path: string): boolean => path.length > 0 && path.length <= 500 && !/[\\:\x00-\x1f]/.test(path) && path.split("/").every(part => part.length > 0 && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part) && !/^(?:\.git|\.adcode|\.env(?:\..*)?|node_modules|\.ssh|\.aws|\.npmrc|\.pypirc|credentials.*|.*\.(?:pem|key|p12|pfx))$/i.test(part));
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw Error("Missing request.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 17 * 1024 * 1024) throw Error("Project exceeds the 16 MB sharing limit."); chunks.push(item.value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const all = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  const value: unknown = JSON.parse(new TextDecoder().decode(all));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid request.");
  return value as Record<string, unknown>;
}

/** Per-owner creation is serialized, including simultaneous requests from different devices. */
export class ProjectAccount extends DurableObject<ProjectEnv> {
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const projects = await this.ctx.storage.get<Summary[]>("owned") ?? [];
      const joined = await this.ctx.storage.get<Summary[]>("joined") ?? [];
      if (request.method === "GET") return json({ owned: projects, joined });
      const input = await body(request);
      const item = input["project"] as Summary | undefined;
      if (!item || !uuid.test(item.id) || typeof item.name !== "string" || typeof item.owner !== "string") return json({ error: "Invalid project." }, 400);
      if (request.method === "DELETE") { await this.ctx.storage.put({ owned: projects.filter(p => p.id !== item.id), joined: joined.filter(p => p.id !== item.id) }); return json({ ok: true }); }
      if (new URL(request.url).pathname === "/join") {
        if (!joined.some(p => p.id === item.id) && !projects.some(p => p.id === item.id)) { if (joined.length >= 1000) return json({ error: "Too many joined projects." }, 409); joined.push(item); await this.ctx.storage.put("joined", joined); }
      } else if (!projects.some(p => p.id === item.id)) {
        if (input["paid"] !== true && projects.length >= 3) return json({ error: "Free includes 3 online projects. Choose a paid plan to create another project.", code: "project-plan-required", upgradeUrl: "https://adcode.bluethenics.com/pricing" }, 402);
        if (projects.length >= 1000) return json({ error: "Project limit reached." }, 409);
        projects.push(item); await this.ctx.storage.put("owned", projects);
      }
      return json({ ok: true });
    });
  }
}

/** Authoritative, persistent project files. Chats and AI credentials are never stored here. */
export class CloudProject extends DurableObject<ProjectEnv> {
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const uid = request.headers.get("x-project-user") ?? "";
      const path = new URL(request.url).pathname;
      let meta = await this.ctx.storage.get<Meta>("meta");
      if (path === "/create" && !meta) {
        const input = await body(request);
        meta = { ...(input["project"] as Summary), revision: 0, invite: crypto.randomUUID().replaceAll("-", ""), members: {} };
        await this.ctx.storage.put("meta", meta);
      }
      if (!meta) return json({ error: "This project no longer exists." }, 404);
      if (path === "/join") {
        const input = await body(request);
        if (input["key"] !== meta.invite) return json({ error: "This invite is no longer valid." }, 403);
        if (Object.keys(meta.members).length >= 100 && !Object.hasOwn(meta.members, uid) && uid !== meta.owner) return json({ error: "This project has reached 100 members." }, 409);
        if (uid !== meta.owner) meta.members = { ...meta.members, [uid]: request.headers.get("x-project-label") ?? "Member" };
        await this.ctx.storage.put("meta", meta);
      }
      const owner = uid === meta.owner;
      if (!owner && !Object.hasOwn(meta.members, uid)) return json({ error: "You do not have access to this project." }, 403);
      if (path === "/delete" && request.method === "POST") {
        if (!owner) return json({ error: "Only the owner can delete this project." }, 403);
        await this.ctx.storage.deleteAll(); return json({ ok: true, owner: meta.owner });
      }
      if (path === "/members" && request.method === "POST") {
        if (!owner) return json({ error: "Only the owner can manage access." }, 403);
        const input = await body(request);
        if (input["rotate"] === true) meta.invite = crypto.randomUUID().replaceAll("-", "");
        if (typeof input["remove"] === "string") delete meta.members[input["remove"]];
        await this.ctx.storage.put("meta", meta);
      }
      if (path === "/files" && request.method === "PUT") {
        const input = await body(request);
        if (input["revision"] !== meta.revision) return json({ error: "Project changed. Fetch the latest files before saving.", code: "project-conflict" }, 409);
        const files = input["files"];
        if (!files || typeof files !== "object" || Array.isArray(files)) return json({ error: "Invalid files." }, 400);
        const entries = Object.entries(files);
        if (entries.length > 4000) return json({ error: "Sharing supports up to 4,000 files." }, 413);
        let size = 0;
        const names = new Set<string>();
        for (const [name, value] of entries) {
          if (!projectPath(name) || typeof value !== "string" || value.length > 1400000 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || names.has(name.toLowerCase())) return json({ error: "Invalid, duplicate or private file: " + name.slice(0, 100) }, 400);
          names.add(name.toLowerCase());
          size += value.length;
        }
        for (const name of names) { const parts = name.split("/"); parts.pop(); while (parts.length) { if (names.has(parts.join("/"))) return json({ error: "A file and folder have the same path." }, 400); parts.pop(); } }
        if (size > 16 * 1024 * 1024) return json({ error: "Project exceeds the 16 MB sharing limit." }, 413);
        // One transaction: readers can never observe a partly uploaded revision.
        await this.ctx.storage.transaction(async txn => {
          const previous = await txn.list({ prefix: "file:" });
          const next = new Set(entries.map(([name]) => "file:" + name));
          for (const key of previous.keys()) if (!next.has(key)) await txn.delete(key);
          for (const [name, value] of entries) await txn.put("file:" + name, value);
          meta!.revision++; await txn.put("meta", meta);
        });
      }
      const summary = { id: meta.id, name: meta.name, owner: meta.owner, isOwner: owner, revision: meta.revision, members: owner ? meta.members : undefined, invite: owner ? `adproject:${meta.id}:${meta.invite}` : undefined };
      if (path === "/files" && request.method === "GET") {
        const files = await this.ctx.storage.list<string>({ prefix: "file:" });
        return json({ ...summary, files: Object.fromEntries([...files].map(([key, value]) => [key.slice(5), value])) });
      }
      return json(summary);
    });
  }
}

export async function projectRequest(request: Request, env: ProjectEnv): Promise<Response> {
  const url = new URL(request.url);
  const who = await verifyIdToken((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""), env.FIREBASE_PROJECT_ID);
  if (!who) return json({ error: "Sign in to open shared projects." }, 401);
  const headers = new Headers({ "x-project-user": who.uid, "x-project-label": who.email ?? "Member" });
  const account = env.PROJECT_ACCOUNTS.getByName(who.uid);
  if (url.pathname === "/projects" && request.method === "GET") return account.fetch("https://account/", { headers });
  if (url.pathname === "/projects" && request.method === "POST") {
    const input = await body(request);
    if (typeof input["name"] !== "string" || !input["name"].trim() || input["name"].length > 100) return json({ error: "Choose a project name (up to 100 characters)." }, 400);
    // Entitlement comes from the billing service, never from the desktop request.
    const usageResponse = await env.ACCOUNT_API.fetch("https://account/v1/ai/tagflow/usage", { headers: { authorization: request.headers.get("authorization")! } });
    if (!usageResponse.ok) return json({ error: "Could not check your plan. Try again shortly." }, 503);
    const usage = await usageResponse.json() as { tokens?: { plan?: { endsAt: number; id: string } | null } };
    const plan = usage.tokens?.plan;
    const paid = !!plan && ["weekly", "monthly", "pro"].includes(plan.id) && plan.endsAt > Date.now();
    const project: Summary = { id: crypto.randomUUID(), name: input["name"].trim(), owner: who.uid };
    const reserved = await account.fetch("https://account/create", { method: "POST", body: JSON.stringify({ project, paid }) });
    if (!reserved.ok) return reserved;
    try {
      const response = await env.PROJECTS.getByName(project.id).fetch("https://project/create", { method: "POST", headers, body: JSON.stringify({ project }) });
      if (!response.ok) await account.fetch("https://account/", { method: "DELETE", body: JSON.stringify({ project }) });
      return response;
    } catch (error) { await account.fetch("https://account/", { method: "DELETE", body: JSON.stringify({ project }) }); throw error; }
  }
  const match = /^\/projects\/([a-f0-9-]{36})(?:\/(files|join|members|delete))?$/.exec(url.pathname);
  if (!match || !uuid.test(match[1]!)) return json({ error: "Not found." }, 404);
  const path = match[2] ?? "info";
  if (!(path === "info" ? request.method === "GET" : path === "files" ? request.method === "GET" || request.method === "PUT" : request.method === "POST")) return json({ error: "Unsupported method." }, 405);
  const response = await env.PROJECTS.getByName(match[1]!).fetch(new Request(`https://project/${path}`, { method: request.method, headers, ...(request.body ? { body: request.body } : {}) }));
  if (response.ok && ((path === "join" && request.method === "POST") || path === "delete")) {
    const summary = await response.clone().json() as Summary;
    await account.fetch("https://account/join", { method: path === "delete" ? "DELETE" : "POST", body: JSON.stringify({ project: { ...summary, id: match[1]!, name: summary.name ?? "Project" } }) });
  }
  return response;
}
