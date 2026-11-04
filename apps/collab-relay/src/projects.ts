import { DurableObject } from "cloudflare:workers";
import { decodeInvite } from "../../../packages/collab/src/invite.ts";
import { PROJECT_INVITE, projectLimits, validRepository, type ProjectEntitlement, type ProjectChatMessage, type ProjectChatSession, type SharedProjectSummary, type SharedProjectSnapshot } from "../../../packages/collab/src/projects.ts";

export class ProjectError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const deny = (status: number, message: string): never => { throw new ProjectError(status, message); };
const secret = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
export const text = (value: unknown, label: string, maximum: number): string => typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value.trim() : deny(400, `${label} must contain 1–${maximum} characters.`);
export const identifier = (value: unknown): string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : deny(400, "Invalid identifier.");
type IndexEntry = { id: string; name: string; repository: string; ownerId: string; owned: number; archived: number };
type Meta = { id: string; name: string; repository: string; ownerId: string; archived: number; invite: string; liveInvite: string | null; liveHost: string | null; liveUntil: number };
type SessionRow = { id: string; title: string; createdBy: string; createdAt: number; updatedAt: number; pendingUid: string | null; pendingKey: string | null; pendingUntil: number };
type MessageRow = { seq: number; id: string; sessionId: string; authorId: string; authorName: string; kind: "member" | "assistant" | "error"; text: string; at: number };

/** One account owns its quota, so simultaneous requests cannot allocate the same free slot. */
export class ProjectDirectory extends DurableObject<CollabRelayEnv> {
  constructor(ctx: DurableObjectState, env: CollabRelayEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, name TEXT, repository TEXT, ownerId TEXT, owned INTEGER, archived INTEGER)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS entitlement(id INTEGER PRIMARY KEY CHECK(id=1), plan TEXT NOT NULL, endsAt INTEGER NOT NULL)");
  }
  limits() {
    const entitlement = this.ctx.storage.sql.exec<{ plan: ProjectEntitlement["plan"]; endsAt: number }>("SELECT plan, endsAt FROM entitlement WHERE id=1").toArray()[0];
    return projectLimits(entitlement ?? null, Date.now());
  }
  setEntitlement(value: ProjectEntitlement) { this.ctx.storage.sql.exec("INSERT OR REPLACE INTO entitlement VALUES(1,?,?)", value.plan, value.endsAt); }
  entries(): IndexEntry[] { return this.ctx.storage.sql.exec<IndexEntry>("SELECT * FROM entries ORDER BY name").toArray(); }
  reserve(entry: Omit<IndexEntry, "owned" | "archived">) {
    return this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql.exec<IndexEntry>("SELECT * FROM entries WHERE id=?", entry.id).toArray()[0];
      if (previous?.owned && !previous.archived) return;
      const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM entries WHERE owned=1 AND archived=0").one().n;
      const limits = this.limits();
      if (count >= limits.projects) deny(402, `${limits.plan === "free" ? "Free" : limits.plan} allows ${limits.projects} owned project${limits.projects === 1 ? "" : "s"}. Archive a project or upgrade for more.`);
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO entries VALUES(?,?,?,?,1,0)", entry.id, entry.name, entry.repository, entry.ownerId);
    });
  }
  remember(entry: Omit<IndexEntry, "owned" | "archived">) {
    if (this.entries().length >= 500 && !this.entries().some(e => e.id === entry.id)) deny(409, "Your shared-project library is full.");
    this.ctx.storage.sql.exec("INSERT INTO entries VALUES(?,?,?,?,0,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name", entry.id, entry.name, entry.repository, entry.ownerId);
  }
  archive(id: string) { this.ctx.storage.sql.exec("UPDATE entries SET archived=1 WHERE id=?", id); }
  forget(id: string) { this.ctx.storage.sql.exec("DELETE FROM entries WHERE id=? AND owned=0", id); }
}

/** One project coordinates persistent membership and conversations independently of file hosts. */
export class SharedProject extends DurableObject<CollabRelayEnv> {
  constructor(ctx: DurableObjectState, env: CollabRelayEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS project(id TEXT PRIMARY KEY, name TEXT, repository TEXT, ownerId TEXT, archived INTEGER, invite TEXT, liveInvite TEXT, liveHost TEXT, liveUntil INTEGER)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS members(uid TEXT PRIMARY KEY, name TEXT NOT NULL, joinedAt INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,pendingUid TEXT,pendingKey TEXT,pendingUntil INTEGER NOT NULL DEFAULT 0)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,sessionId TEXT NOT NULL,authorId TEXT NOT NULL,authorName TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(sessionId,authorId,id))");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS messages_session ON messages(sessionId,seq)");
  }
  private meta(): Meta { return this.ctx.storage.sql.exec<Meta>("SELECT * FROM project").toArray()[0] ?? deny(404, "Project not found."); }
  private member(uid: string) { return this.ctx.storage.sql.exec<{ uid: string; name: string; joinedAt: number }>("SELECT * FROM members WHERE uid=?", uid).toArray()[0] ?? deny(403, "You are not a member of this project."); }
  private writable(uid: string) { this.member(uid); if (this.meta().archived) deny(409, "This project is archived. Its chat history is read-only."); }
  private owner(uid: string) { const meta = this.meta(); if (meta.ownerId !== uid) deny(403, "Only the owner can manage this project."); return meta; }
  async summary(uid: string): Promise<SharedProjectSummary> {
    this.member(uid); const meta = this.meta(), limits = await ownerLimits(this.env, meta.ownerId);
    return { id: meta.id, name: meta.name, repository: meta.repository, ownerId: meta.ownerId, archived: !!meta.archived, memberCount: this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM members").one().n, memberLimit: limits.members };
  }
  initialize(id: string, uid: string, name: string, repository: string, displayName: string) {
    this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql.exec<Meta>("SELECT * FROM project").toArray()[0];
      if (previous && (previous.ownerId !== uid || previous.repository !== repository)) deny(409, "Project identity does not match.");
      if (previous) this.ctx.storage.sql.exec("UPDATE project SET archived=0 WHERE id=?", id);
      else this.ctx.storage.sql.exec("INSERT INTO project VALUES(?,?,?,?,0,?,NULL,NULL,0)", id, name, repository, uid, secret());
      this.ctx.storage.sql.exec("INSERT INTO members VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name", uid, displayName, Date.now());
    });
  }
  async admit(uid: string, name: string, key: string) {
    const meta = this.meta(), limits = await ownerLimits(this.env, meta.ownerId);
    this.ctx.storage.transactionSync(() => {
      const current = this.meta();
      if (current.archived || current.invite !== key) deny(403, "This project invite has expired or was replaced.");
      const exists = this.ctx.storage.sql.exec("SELECT uid FROM members WHERE uid=?", uid).toArray().length > 0;
      if (!exists && this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM members").one().n >= limits.members) deny(402, `This project's ${limits.plan} plan allows ${limits.members} people, including the owner. Ask the owner to upgrade or remove a member.`);
      this.ctx.storage.sql.exec("INSERT INTO members VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name", uid, name, Date.now());
    });
    return { id: meta.id, name: meta.name, repository: meta.repository, ownerId: meta.ownerId };
  }
  canUse(uid: string) { this.writable(uid); return { repository: this.meta().repository }; }
  async snapshot(uid: string, selected?: string, before?: number): Promise<SharedProjectSnapshot> {
    const summary = await this.summary(uid); this.member(uid);
    const meta = this.meta();
    const sessions = this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions ORDER BY updatedAt DESC LIMIT 100").toArray();
    const session = selected ? sessions.find(s => s.id === selected) : sessions[0];
    if (selected && !session) deny(404, "Chat session not found in this project.");
    const rows = session ? this.ctx.storage.sql.exec<MessageRow>("SELECT seq,id,sessionId,authorId,authorName,kind,text,at FROM messages WHERE sessionId=? AND seq<? ORDER BY seq DESC LIMIT 101", session.id, before ?? Number.MAX_SAFE_INTEGER).toArray() : [];
    const members = this.ctx.storage.sql.exec<{ uid: string; name: string; joinedAt: number; messages: number; sessions: number }>("SELECT uid,name,joinedAt,(SELECT COUNT(*) FROM messages WHERE authorId=members.uid AND kind='member') messages,(SELECT COUNT(*) FROM sessions WHERE createdBy=members.uid) sessions FROM members ORDER BY joinedAt").toArray();
    return { ...summary, selfId: uid, members, sessions: sessions.map(s => ({ id: s.id, title: s.title, createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: s.updatedAt, pending: s.pendingUntil > Date.now() })), messages: rows.slice(0,100).reverse(), selectedSession: session?.id ?? null, hasOlder: rows.length > 100, invite: uid === meta.ownerId ? `adproject:${meta.id}:${meta.invite}` : null, liveInvite: meta.liveUntil > Date.now() ? meta.liveInvite : null };
  }
  createSession(uid: string, title: string, id: string) {
    this.writable(uid);
    if (this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM sessions").one().n >= 100) deny(409, "This project has reached its 100-session limit.");
    const now = Date.now();
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO sessions(id,title,createdBy,createdAt,updatedAt) VALUES(?,?,?,?,?)", id, title, uid, now, now);
    return id;
  }
  post(uid: string, sessionId: string, message: string, id: string, ask: boolean) {
    return this.ctx.storage.transactionSync(() => {
      this.writable(uid); const member = this.member(uid);
      const session = this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id=?", sessionId).toArray()[0] ?? deny(404, "Chat session not found.");
      const duplicate = this.ctx.storage.sql.exec("SELECT seq FROM messages WHERE sessionId=? AND authorId=? AND id=?", sessionId, uid, id).toArray().length > 0;
      if (duplicate) return { duplicate: true, lease: null };
      if (ask && session.pendingUntil > Date.now()) deny(409, "The assistant is already replying in this session. You can still send a team message.");
      if (this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM messages WHERE sessionId=?", sessionId).one().n >= 5000) deny(409, "Start a new session to continue this conversation.");
      const recent = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM messages WHERE authorId=? AND at>?", uid, Date.now()-60_000).one().n;
      if (recent >= 30) deny(429, "Please wait a moment before sending more messages.");
      this.ctx.storage.sql.exec("INSERT INTO messages(id,sessionId,authorId,authorName,kind,text,at) VALUES(?,?,?,?,'member',?,?)", id, sessionId, uid, member.name, message, Date.now());
      const lease = ask ? secret() : null;
      if (ask) this.ctx.storage.sql.exec("UPDATE sessions SET pendingUid=?,pendingKey=?,pendingUntil=?,updatedAt=? WHERE id=?", uid, lease, Date.now()+10*60_000, Date.now(), sessionId);
      else this.ctx.storage.sql.exec("UPDATE sessions SET updatedAt=? WHERE id=?", Date.now(), sessionId);
      return { duplicate: false, lease };
    });
  }
  finish(uid: string, sessionId: string, lease: string, message: string, failed: boolean) {
    this.ctx.storage.transactionSync(() => {
      this.writable(uid);
      const session = this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id=?", sessionId).toArray()[0];
      if (!session || session.pendingUid !== uid || session.pendingKey !== lease || session.pendingUntil <= Date.now()) deny(409, "This assistant turn expired. Start a new one.");
      this.ctx.storage.sql.exec("INSERT INTO messages(id,sessionId,authorId,authorName,kind,text,at) VALUES(?,?,?,'Assistant',?,?,?)", crypto.randomUUID(), sessionId, uid, failed ? "error" : "assistant", message, Date.now());
      this.ctx.storage.sql.exec("UPDATE sessions SET pendingUid=NULL,pendingKey=NULL,pendingUntil=0,updatedAt=? WHERE id=?", Date.now(), sessionId);
    });
  }
  renewTurn(uid: string, sessionId: string, lease: string) {
    this.writable(uid);
    const session = this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id=?", sessionId).toArray()[0];
    if (!session || session.pendingUid !== uid || session.pendingKey !== lease || session.pendingUntil <= Date.now()) deny(409, "This assistant turn expired.");
    this.ctx.storage.sql.exec("UPDATE sessions SET pendingUntil=? WHERE id=?", Date.now()+10*60_000, sessionId);
  }
  remove(uid: string, target: string) {
    this.member(uid); const meta = this.meta();
    if (target === meta.ownerId) deny(409, "The owner must archive the project instead of leaving.");
    if (uid !== meta.ownerId && uid !== target) deny(403, "Only the owner can remove other members.");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM members WHERE uid=?", target);
      this.ctx.storage.sql.exec("UPDATE sessions SET pendingUid=NULL,pendingKey=NULL,pendingUntil=0 WHERE pendingUid=?", target);
      this.ctx.storage.sql.exec("UPDATE project SET invite=?", secret());
    });
  }
  archive(uid: string) { this.owner(uid); this.ctx.storage.sql.exec("UPDATE project SET archived=1,liveInvite=NULL,liveUntil=0"); }
  rotate(uid: string) { this.owner(uid); this.ctx.storage.sql.exec("UPDATE project SET invite=?", secret()); }
  setLive(uid: string, invite: string | null) {
    this.writable(uid);
    if (invite === null && this.meta().liveHost !== uid) return;
    this.ctx.storage.sql.exec("UPDATE project SET liveInvite=?,liveHost=?,liveUntil=?", invite, uid, invite ? Date.now()+24*60*60_000 : 0);
  }
  endLive(key: string) {
    // A delayed close from an old room cannot clear a replacement session.
    const meta=this.meta();
    if(meta.liveInvite && decodeInvite(meta.liveInvite)?.token===key) this.ctx.storage.sql.exec("UPDATE project SET liveInvite=NULL,liveHost=NULL,liveUntil=0");
  }
}

export async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) return {};
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 128_000) { await reader.cancel(); deny(413, "Request too large."); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) deny(400, "Expected an object.");
    return raw as Record<string, unknown>;
  } catch (error) { if (error instanceof ProjectError) throw error; return deny(400, "Invalid JSON."); }
}

export async function ownerLimits(env: CollabRelayEnv, uid: string) {
  const entitlement = await (env.ENTITLEMENTS as typeof env.ENTITLEMENTS & { getPlan(uid: string): Promise<ProjectEntitlement> }).getPlan(uid);
  return projectLimits(entitlement, Date.now());
}
export async function refreshEntitlement(_request: Request, env: CollabRelayEnv, uid: string) {
  const verified: ProjectEntitlement = await (env.ENTITLEMENTS as typeof env.ENTITLEMENTS & { getPlan(uid: string): Promise<ProjectEntitlement> }).getPlan(uid);
  await env.PROJECT_ACCOUNTS.getByName(uid).setEntitlement(verified);
}

/** Only called after Firebase verification. Request data can never select another account. */
export async function projectRoute(request: Request, env: CollabRelayEnv, uid: string): Promise<Response> {
  const url = new URL(request.url), directory = env.PROJECT_ACCOUNTS.getByName(uid);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  try {
    if (url.pathname === "/projects" && request.method === "GET") {
      await refreshEntitlement(request, env, uid);
      const entries = await directory.entries(), projects: SharedProjectSummary[] = [];
      for (const entry of entries) {
        try { projects.push(await env.SHARED_PROJECTS.getByName(entry.id).summary(uid)); } catch { /* Removed memberships are not listed. */ }
      }
      return json({ projects, limits: await directory.limits(), owned: entries.filter(e => e.owned && !e.archived).length });
    }
    const body = request.method === "GET" ? {} : await boundedJson(request);
    if (url.pathname === "/projects/create" && request.method === "POST") {
      if (!validRepository(body.repository)) deny(400, "Connect a GitHub repository before sharing this project.");
      await refreshEntitlement(request, env, uid);
      const repository = (body.repository as string).toLowerCase(), name = text(body.name, "Project name", 100), displayName = text(body.displayName, "Your name", 64);
      const id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${uid}\0${repository}`)))).map(v => v.toString(16).padStart(2,"0")).join("");
      await directory.reserve({ id, name, repository, ownerId: uid });
      const project = env.SHARED_PROJECTS.getByName(id); await project.initialize(id, uid, name, repository, displayName);
      return json(await project.snapshot(uid));
    }
    if (url.pathname === "/projects/join" && request.method === "POST") {
      const match = PROJECT_INVITE.exec(text(body.invite, "Project invite", 300));
      if (!match) deny(400, "Paste a shared-project invite beginning with adproject:.");
      const project = env.SHARED_PROJECTS.getByName(match![1]!);
      const entry = await project.admit(uid, text(body.displayName, "Your name", 64), match![2]!); await directory.remember(entry);
      return json(await project.snapshot(uid));
    }
    const match = /^\/projects\/([a-f0-9]{64})(?:\/(sessions|messages|finish|renew|members|archive|invite|live))?$/.exec(url.pathname);
    if (!match) return json({ error: "Not found." }, 404);
    const id = match[1]!, project = env.SHARED_PROJECTS.getByName(id), action = match[2];
    if (!action && request.method === "GET") {
      const selected = url.searchParams.get("session") ?? undefined, before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined;
      if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) deny(400, "Invalid history cursor.");
      return json(await project.snapshot(uid, selected, before));
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (action === "sessions") { const sessionId = await project.createSession(uid, text(body.title,"Session title",100), identifier(body.id)); return json(await project.snapshot(uid, sessionId)); }
    if (action === "messages") {
      const sessionId = identifier(body.sessionId), result = await project.post(uid, sessionId, text(body.text,"Message",8000), identifier(body.id), body.ask === true);
      return json({ ...result, snapshot: await project.snapshot(uid, sessionId) });
    }
    if (action === "finish") { await project.finish(uid,identifier(body.sessionId),text(body.lease,"Turn",100),text(body.text,"Assistant reply",60000),body.failed === true); return json({ ok: true }); }
    if (action === "renew") { await project.renewTurn(uid,identifier(body.sessionId),text(body.lease,"Turn",100)); return json({ ok:true }); }
    if (action === "members") { const target = text(body.uid,"Member",128); await project.remove(uid,target); await env.ROOMS.getByName(id).removeAccount(target); await env.PROJECT_ACCOUNTS.getByName(target).forget(id); return json({ ok: true }); }
    if (action === "archive") { await project.archive(uid); await directory.archive(id); await env.ROOMS.getByName(id).endProject(); return json({ ok: true }); }
    if (action === "invite") { await project.rotate(uid); return json(await project.snapshot(uid)); }
    if (action === "live") { await project.setLive(uid,body.invite === null ? null : text(body.invite,"Live invite",2000)); return json({ ok: true }); }
    return json({ error: "Not found." },404);
  } catch (error) {
    // RPC exceptions retain their message but not custom error subclasses/status fields.
    const message = error instanceof Error ? error.message : "Project service unavailable.";
    return json({ error: message.replace(/^remote exception: /, ""), upgrade: /allows .* (?:owned project|people)/.test(message) }, error instanceof ProjectError ? error.status : /not a member|Only the owner|invite.*(?:expired|replaced)/.test(message) ? 403 : /allows .* (?:owned project|people)/.test(message) ? 402 : 409);
  }
}
