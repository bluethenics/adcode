/**
 * Phone link: a person's phone chatting with ADCode on their own computer.
 *
 * One room per account, named by the account's uid. The computer joins as a host when the
 * person turns Phone link on; a phone joins from web.bluethenics.com/phone signed in to the same
 * account. The room tells each side who is on the other, and forwards their messages - it
 * stores nothing, reads nothing and logs nothing, and closes with the last connection.
 *
 * The computer does the work, so when it is off, asleep or out of battery there is no host and
 * the phone says so: nothing here can reach the computer by any other way.
 *
 * Who may join is settled before the room is reached (`phoneLinkRoute`): a verified Firebase
 * sign-in for both sides, and the uid in it is the room's name, so a sign-in can only ever
 * reach its own room. A phone also has to come from an allowed page.
 */
import { DurableObject } from "cloudflare:workers";

type Role = "host" | "phone";

interface Attachment {
  readonly role: Role;
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly since: number;
  minute: number;
  count: number;
  bytes: number;
}

export const PHONE_LIMITS = {
  hosts: 4,
  phones: 6,
  frame: 512 * 1024,
  /** Frames a minute: a streamed reply is many small ones. */
  hostFrames: 6_000,
  phoneFrames: 240,
} as const;

const clean = (value: string | null, fallback: string, max = 60): string => {
  const trimmed = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return trimmed.length === 0 ? fallback : trimmed;
};

export class PhoneLink extends DurableObject<CollabRelayEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role: Role | null = url.pathname === "/host" ? "host" : url.pathname === "/phone" ? "phone" : null;
    if (role === null) return new Response("Not found", { status: 404 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const same = this.ctx.getWebSockets(role);
    if (same.length >= (role === "host" ? PHONE_LIMITS.hosts : PHONE_LIMITS.phones)) {
      // A computer reconnecting after its network dropped replaces its own old connection.
      const id = url.searchParams.get("device");
      const stale = role === "host" && id !== null ? same.find((socket) => (socket.deserializeAttachment() as Attachment).id === id) : undefined;
      if (stale === undefined) return new Response("Too many connections", { status: 409 });
      try { stale.close(1000, "Replaced"); } catch { /* Already closed. */ }
    }
    const pair = new WebSocketPair();
    const meta: Attachment = {
      role,
      id: role === "host" ? clean(url.searchParams.get("device"), crypto.randomUUID(), 64) : crypto.randomUUID(),
      name: clean(url.searchParams.get("name"), role === "host" ? "Computer" : "Phone"),
      platform: clean(url.searchParams.get("platform"), "", 20),
      since: Date.now(),
      minute: 0,
      count: 0,
      bytes: 0,
    };
    pair[1].serializeAttachment(meta);
    this.ctx.acceptWebSocket(pair[1], [role]);
    this.presence();
    const protocol = role === "phone" ? request.headers.get("sec-websocket-protocol")?.split(",").map((one) => one.trim()).find((one) => one === "adcode.phone.v1") : undefined;
    return new Response(null, { status: 101, webSocket: pair[0], ...(protocol === undefined ? {} : { headers: { "sec-websocket-protocol": protocol } }) });
  }

  private sockets(role: Role): { socket: WebSocket; meta: Attachment }[] {
    return this.ctx.getWebSockets(role).map((socket) => ({ socket, meta: socket.deserializeAttachment() as Attachment }));
  }

  private send(socket: WebSocket, value: unknown): void {
    try { socket.send(JSON.stringify(value)); } catch { try { socket.close(1011, "Connection failed"); } catch { /* Gone. */ } }
  }

  /** Each side is told who is on the other, every time that changes. */
  private presence(leaving?: WebSocket): void {
    const live = (role: Role) => this.sockets(role).filter((one) => one.socket !== leaving);
    const hosts = live("host").map(({ meta }) => ({ id: meta.id, name: meta.name, platform: meta.platform, since: meta.since }));
    const phones = live("phone").map(({ meta }) => ({ id: meta.id, label: meta.name, since: meta.since }));
    for (const { socket } of live("phone")) this.send(socket, { type: "hosts", hosts });
    for (const { socket } of live("host")) this.send(socket, { type: "phones", phones });
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const meta = socket.deserializeAttachment() as Attachment;
    if (typeof raw !== "string" || raw.length > PHONE_LIMITS.frame) { socket.close(1009, "Frame too large"); return; }
    const minute = Math.floor(Date.now() / 60_000);
    if (meta.minute !== minute) { meta.minute = minute; meta.count = 0; meta.bytes = 0; }
    meta.count++;
    meta.bytes += raw.length;
    if (meta.count > (meta.role === "host" ? PHONE_LIMITS.hostFrames : PHONE_LIMITS.phoneFrames)) { socket.close(1008, "Too many messages"); return; }
    socket.serializeAttachment(meta);

    let frame: { type?: unknown; host?: unknown; phone?: unknown; data?: unknown };
    try { frame = JSON.parse(raw) as typeof frame; } catch { socket.close(1003, "Invalid frame"); return; }
    if (frame.type === "ping") { this.send(socket, { type: "pong" }); return; }

    if (meta.role === "phone") {
      if (frame.type !== "to" || typeof frame.host !== "string" || typeof frame.data !== "string") return;
      const host = this.sockets("host").find((one) => one.meta.id === frame.host);
      if (host === undefined) { this.send(socket, { type: "gone", host: frame.host }); return; }
      this.send(host.socket, { type: "from", phone: meta.id, data: frame.data });
      return;
    }

    if (frame.type === "kick" && typeof frame.phone === "string") {
      for (const { socket: phone, meta: one } of this.sockets("phone")) if (one.id === frame.phone) phone.close(4403, "Disconnected from your computer");
      return;
    }
    if (frame.type !== "to" || typeof frame.data !== "string") return;
    for (const { socket: phone, meta: one } of this.sockets("phone")) {
      if (typeof frame.phone === "string" && one.id !== frame.phone) continue;
      this.send(phone, { type: "from", host: meta.id, data: frame.data });
    }
  }

  webSocketClose(socket: WebSocket): void {
    this.presence(socket);
  }

  webSocketError(socket: WebSocket): void {
    try { socket.close(1011, "Connection failed"); } catch { /* Gone. */ }
    this.presence(socket);
  }
}

/**
 * `/phone/host` and `/phone/phone`. The computer sends its sign-in as a Bearer header; a browser
 * cannot set headers on a WebSocket, so the phone offers it as an `auth.<token>` subprotocol.
 */
export async function phoneLinkRoute(
  request: Request,
  env: CollabRelayEnv,
  verify: (token: string) => Promise<{ uid: string } | null>,
  allowedOrigins: readonly string[],
): Promise<Response> {
  const url = new URL(request.url);
  const role = url.pathname === "/phone/host" ? "host" : url.pathname === "/phone/phone" ? "phone" : null;
  if (role === null) return Response.json({ error: "Not found." }, { status: 404 });
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return Response.json({ error: "WebSocket required." }, { status: 426 });
  let token: string | null = null;
  if (role === "host") {
    const header = request.headers.get("authorization") ?? "";
    token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  } else {
    if (!allowedOrigins.includes(request.headers.get("origin") ?? "")) return Response.json({ error: "Forbidden." }, { status: 403 });
    for (const offered of (request.headers.get("sec-websocket-protocol") ?? "").split(",")) {
      const value = offered.trim();
      if (value.startsWith("auth.") && value.length > 5) token = value.slice(5);
    }
  }
  const who = token === null ? null : await verify(token);
  if (who === null) {
    if (role === "host") return Response.json({ error: "Sign in to ADCode to use Phone link." }, { status: 401 });
    // A browser cannot read a refused upgrade's status; a close code it can.
    const pair = new WebSocketPair();
    pair[1].accept();
    pair[1].close(4401, "Signed out");
    return new Response(null, { status: 101, webSocket: pair[0], headers: { "sec-websocket-protocol": "adcode.phone.v1" } });
  }
  const target = new URL(`https://phone.link/${role}`);
  target.search = url.search;
  return env.PHONE_LINKS.getByName(who.uid).fetch(new Request(target, request));
}

export const PHONE_ORIGINS = ["https://web.bluethenics.com", "https://adcode.bluethenics.com"] as const;
