import WebSocket from "ws";
import { join } from "node:path";
import { app } from "electron";
import { parse, serialise, LIMITS, type Message } from "@adcode/collab";
import { createBackendTokens } from "../backend.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "../adPorts.ts";
import { lanTransport } from "./lanTransport.ts";
import type { TransportFactory, PeerLink } from "./transport.ts";

const ORIGIN = "https://collab.bluethenics.com";
export const RELAY_SUFFIX = ".relay.adcode";
export const isRelayHost = (host: string): boolean => /^[a-f0-9]{64}\.relay\.adcode$/.test(host);
async function connect(path: string, key: string): Promise<WebSocket> {
  const socket = new WebSocket(ORIGIN.replace("https:", "wss:") + path, { headers: { authorization: `Bearer ${key}` }, maxPayload: LIMITS.frame * 2, handshakeTimeout: 15_000 });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) { socket.terminate(); return; }
    if (socket.readyState === WebSocket.OPEN) { alive = false; socket.ping(); }
  }, 20_000);
  heartbeat.unref();
  socket.on("pong", () => { alive = true; });
  socket.once("close", () => clearInterval(heartbeat));
  return socket;
}

/** The host's permission checks and Yjs state are unchanged; only the encrypted wire differs. */
export const sharedTransport: TransportFactory = {
  async startHost(options, events) {
    if (options.bind !== "internet") return lanTransport.startHost(options, events);
    const auth = createBackendTokens({ clock: new SystemClock(), http: new FetchHttpTransport([]), store: new DiskFileStore(join(app.getPath("userData"), "ads")) });
    const credential = await auth.getToken();
    if (!credential.ok) throw new Error("Sign in before sharing a project online.");
    const response = await fetch(`${ORIGIN}/rooms`, { method: "POST", headers: { authorization: `Bearer ${credential.value}`, "content-type": "application/json" }, body: JSON.stringify({ guestKey: options.token }), signal: AbortSignal.timeout(15_000) });
    const room = await response.json() as { id?: string; hostKey?: string; error?: string };
    if (!response.ok || !room.id || !room.hostKey) throw new Error(room.error ?? "Could not create the shared project.");
    const socket = await connect(`/room/${room.id}/host`, room.hostKey);
    const links = new Map<string, PeerLink>();
    let closing = false;
    const send = (peer: string, message: Message): void => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ peer, data: serialise(message) })); };
    socket.on("message", raw => {
      let frame: { type?: string; peer?: string; data?: string };
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (typeof frame.peer !== "string") return;
      if (frame.type === "connected") {
        const id = frame.peer;
        const link: PeerLink = { id, address: "Encrypted relay", send: message => send(id, message), close: reason => {
          if (reason) send(id, { type: "refused", reason });
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ peer: id, close: true }));
        } };
        links.set(id, link); events.onPeerConnected(link);
      } else {
        const link = links.get(frame.peer); if (!link) return;
        if (frame.type === "closed") { links.delete(link.id); events.onPeerClosed(link); }
        else if (frame.type === "message" && typeof frame.data === "string") {
          const message = parse(frame.data);
          if (message) events.onMessage(link, message); else events.onPeerFault(link, "Invalid collaboration message");
        }
      }
    });
    socket.on("error", () => { if (!closing) events.onError("The shared project connection was interrupted. End this session and share a new invite."); });
    socket.on("close", () => { for (const link of links.values()) events.onPeerClosed(link); links.clear(); if (!closing) events.onError("The shared project ended. Share a new invite to reconnect."); });
    return { port: 443, addresses: [room.id + RELAY_SUFFIX],
      broadcast(message, opts) { for (const link of links.values()) if (link.id !== opts?.except) send(link.id, message); },
      send(peer, message) { send(peer, message); },
      async close() { closing = true; socket.close(1000); },
    };
  },
  async connectGuest(target, events) {
    if (!isRelayHost(target.host)) return lanTransport.connectGuest(target, events);
    if (!target.token) throw new Error("This invite has no access key.");
    const socket = await connect(`/room/${target.host.slice(0, -RELAY_SUFFIX.length)}/guest`, target.token);
    socket.on("message", raw => { const message = parse(raw.toString()); if (message) events.onMessage(message); else events.onError("The host sent an invalid collaboration message."); });
    socket.on("error", () => events.onError("The shared project connection was interrupted."));
    socket.on("close", () => events.onClosed("The host disconnected or ended this session. Ask for a new invite."));
    return { send(message) { if (socket.readyState === WebSocket.OPEN) socket.send(serialise(message)); }, async close() { socket.close(1000); } };
  },
};
