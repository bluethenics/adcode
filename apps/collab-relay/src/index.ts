import { DurableObject } from "cloudflare:workers";
import { verifyIdToken } from "../../cloud/src/auth.ts";
import { boundedJson, projectRoute, ProjectDirectory, SharedProject } from "./projects.ts";
import { communityRoute, CommunityHub, ArtifactVault } from "./community.ts";
import { ArtifactRoom } from "./artifactRoom.ts";
export { ProjectDirectory, SharedProject, CommunityHub, ArtifactVault, ArtifactRoom };
export { PriorityQueue, RequestPriority } from "./priority.ts";

type Env = CollabRelayEnv;
type Attachment = { role: "host" | "guest"; uid?: string; id: string; generation: string; minute: number; count: number; bytes: number };
type Keys = { host: string; guest: string; expires: number; generation: string; projectId?: string };
const json = (value: unknown, status = 200): Response => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const secret = (): string => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

/** Only credentials and expiry persist; document content is relayed without storage or logging. */
export class CollabRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let keys = await this.ctx.storage.get<Keys>("keys");
    if (path === "/create") {
      return this.ctx.blockConcurrencyWhile(async () => {
      keys = await this.ctx.storage.get<Keys>("keys");
      if (keys && keys.expires > Date.now() && (this.ctx.getWebSockets("host").length > 0 || keys.expires - Date.now() > 24 * 60 * 60_000 - 30_000)) return json({ error: "End your current shared project first. If its connection failed, wait 30 seconds before trying again." }, 409);
      const body = await request.json() as { guestKey?: unknown; projectId?: string };
      if (typeof body.guestKey !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(body.guestKey)) return json({ error: "Invalid invite." }, 400);
      keys = { host: secret(), guest: body.guestKey, expires: Date.now() + 24 * 60 * 60_000, generation: crypto.randomUUID(), ...(body.projectId ? { projectId: body.projectId } : {}) };
      await this.ctx.storage.put("keys", keys);
      await this.ctx.storage.setAlarm(keys.expires);
      return json({ hostKey: keys.host });
      });
    }
    if (!keys || keys.expires <= Date.now()) return json({ error: "This session ended. Ask for a new invite." }, 410);
    const role = path === "/host" ? "host" : path === "/guest" ? "guest" : null;
    if (!role || request.headers.get("authorization") !== `Bearer ${keys[role]}`) return json({ error: "Invalid invite." }, 403);
    let uid: string | undefined;
    if (keys.projectId) {
      const who = await verifyIdToken(request.headers.get("x-adcode-account-token") ?? "", this.env.FIREBASE_PROJECT_ID);
      if (!who) return json({ error: "Sign in and join this shared project first." },401);
      try { await this.env.SHARED_PROJECTS.getByName(keys.projectId).canUse(who.uid); } catch { return json({ error: "Join this project with its permanent project invite before entering the live session." },403); }
      uid = who.uid;
      if (this.ctx.getWebSockets().some(socket => (socket.deserializeAttachment() as Attachment).uid === uid)) return json({ error: "You are already connected to this project's live session." },409);
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket required." }, 426);
    if (role === "host" && this.ctx.getWebSockets("host").length) return json({ error: "Host already connected." }, 409);
    if (role === "guest" && (!this.ctx.getWebSockets("host").length || this.ctx.getWebSockets("guest").length >= (keys.projectId ? 63 : 31))) return json({ error: "The host is offline or the session is full." }, 409);
    const pair = new WebSocketPair();
    const meta: Attachment = { role, ...(uid ? { uid } : {}), id: crypto.randomUUID(), generation: keys.generation, minute: 0, count: 0, bytes: 0 };
    pair[1].serializeAttachment(meta);
    this.ctx.acceptWebSocket(pair[1], [role]);
    if (role === "guest") this.sendHost({ type: "connected", peer: meta.id });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  private sendHost(value: unknown): void {
    for (const socket of this.ctx.getWebSockets("host")) try { socket.send(JSON.stringify(value)); } catch { socket.close(1011, "Connection failed"); }
  }
  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const meta = socket.deserializeAttachment() as Attachment;
    if (typeof raw !== "string" || raw.length > 16 * 1024 * 1024) { socket.close(1009, "Frame too large"); return; }
    const minute = Math.floor(Date.now() / 60_000);
    if (meta.minute !== minute) { meta.minute = minute; meta.count = 0; meta.bytes = 0; }
    meta.count++; meta.bytes += raw.length;
    if (meta.count > (meta.role === "host" ? 8000 : 2000) || meta.bytes > (meta.role === "host" ? 256 : 64) * 1024 * 1024) { socket.close(1008, "Session traffic limit"); return; }
    socket.serializeAttachment(meta);
    if (meta.role === "guest") { this.sendHost({ type: "message", peer: meta.id, data: raw }); return; }
    let frame: { peer?: unknown; data?: unknown; close?: unknown };
    try { frame = JSON.parse(raw); } catch { socket.close(1003, "Invalid frame"); return; }
    if (typeof frame.peer !== "string") return;
    for (const peer of this.ctx.getWebSockets("guest")) {
      if ((peer.deserializeAttachment() as Attachment).id !== frame.peer) continue;
      if (frame.close === true) peer.close(1000, "Removed by host");
      else if (typeof frame.data === "string") try { peer.send(frame.data); } catch { peer.close(1011, "Connection failed"); }
    }
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    const meta = socket.deserializeAttachment() as Attachment;
    if (meta.role === "host" && (await this.ctx.storage.get<Keys>("keys"))?.generation === meta.generation) await this.end();
    else this.sendHost({ type: "closed", peer: meta.id });
  }
  async webSocketError(socket: WebSocket): Promise<void> { socket.close(1011, "Connection failed"); await this.webSocketClose(socket); }
  private async end(): Promise<void> {
    const keys=await this.ctx.storage.get<Keys>("keys");
    if(keys?.projectId) await this.env.SHARED_PROJECTS.getByName(keys.projectId).endLive(keys.guest).catch(()=>{});
    for (const socket of this.ctx.getWebSockets()) try { socket.close(1000, "Session ended"); } catch { /* Already closed. */ }
    await this.ctx.storage.deleteAll();
  }
  async alarm(): Promise<void> { await this.end(); }
  async removeAccount(uid: string): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const meta = socket.deserializeAttachment() as Attachment;
      if (meta.uid !== uid) continue;
      if (meta.role === "host") { await this.end(); return; }
      socket.close(1008,"Project access removed");
    }
  }
  async endProject(): Promise<void> { await this.end(); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/community" || url.pathname.startsWith("/community/")) {
      // Reading the directory is public; the route itself decides what needs an account.
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /,"");
      const who = token ? await verifyIdToken(token, env.FIREBASE_PROJECT_ID) : null;
      if (token && !who && request.method !== "GET") return json({ error: "Your ADCode sign-in has expired. Sign in again." }, 401);
      return communityRoute(request, env, who);
    }
    if (url.pathname === "/projects" || url.pathname.startsWith("/projects/")) {
      const who = await verifyIdToken((request.headers.get("authorization") ?? "").replace(/^Bearer /,""),env.FIREBASE_PROJECT_ID);
      if (!who?.email) return json({ error: "Sign in with Google, GitHub, or email to use shared projects." },401);
      return projectRoute(request,env,who.uid);
    }
    if (url.pathname === "/rooms" && request.method === "POST") {
      if (Number(request.headers.get("content-length") ?? 0) > 1024) return json({ error: "Request too large." }, 413);
      const who = await verifyIdToken((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""), env.FIREBASE_PROJECT_ID);
      if (!who) return json({ error: "Sign in to share a project." }, 401);
      try {
        const body = await boundedJson(request);
        if (body.projectId !== undefined && (typeof body.projectId !== "string" || !/^[a-f0-9]{64}$/.test(body.projectId))) return json({ error: "Invalid shared project." },400);
        if (typeof body.projectId === "string") await env.SHARED_PROJECTS.getByName(body.projectId).canUse(who.uid);
        const id = typeof body.projectId === "string" ? body.projectId : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(who.uid)))).map(x => x.toString(16).padStart(2, "0")).join("");
        const response = await env.ROOMS.getByName(id).fetch(new Request("https://room/create", { method: "POST", body: JSON.stringify(body) }));
        if (!response.ok) return response;
        return json({ ...await response.json() as object, id });
      } catch { return json({ error: "Could not create the session." }, 400); }
    }
    const match = /^\/room\/([a-f0-9]{64})\/(host|guest)$/.exec(url.pathname);
    if (!match) return json({ error: "Not found." }, 404);
    return env.ROOMS.getByName(match[1]!).fetch(new Request(`https://room/${match[2]}`, request));
  },
} satisfies ExportedHandler<Env>;
