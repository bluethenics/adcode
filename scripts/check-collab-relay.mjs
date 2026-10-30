import { Miniflare, convertV4MiniflareOptions } from "../apps/cloud/node_modules/miniflare/dist/src/index.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: readFileSync("apps/collab-relay/output/collab-relay-build/index.js", "utf8"), compatibilityDate: "2026-10-13", durableObjects: { ROOMS: { className: "CollabRoom", useSQLite: true } }, bindings: { FIREBASE_PROJECT_ID: "adcode-idle" } }));
try {
  assert.equal((await mf.dispatchFetch("https://relay/rooms", { method: "POST", body: "{}" })).status, 401);
  const ns = await mf.getDurableObjectNamespace("ROOMS");
  const stub = ns.get(ns.idFromName("integration"));
  const created = await stub.fetch("https://room/create", { method: "POST", body: JSON.stringify({ guestKey: "a".repeat(32) }) });
  assert.equal(created.status, 200);
  const { hostKey } = await created.json();
  assert.equal((await stub.fetch("https://room/guest", { headers: { upgrade: "websocket", authorization: "Bearer wrong" } })).status, 403);
  assert.equal((await stub.fetch("https://room/guest", { headers: { upgrade: "websocket", authorization: "Bearer " + "a".repeat(32) } })).status, 409);
  const hostResponse = await stub.fetch("https://room/host", { headers: { upgrade: "websocket", authorization: "Bearer " + hostKey } });
  const host = hostResponse.webSocket; host.accept();
  const next = socket => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("WebSocket message timed out")), 3000);
    socket.addEventListener("message", event => { clearTimeout(timeout); resolve(JSON.parse(event.data)); }, { once: true });
  });
  const connected = next(host);
  const guestResponse = await stub.fetch("https://room/guest", { headers: { upgrade: "websocket", authorization: "Bearer " + "a".repeat(32) } });
  const guest = guestResponse.webSocket; guest.accept();
  const peer = await connected;
  assert.equal(peer.type, "connected");
  const inbound = next(host);
  guest.send(JSON.stringify({ type: "hello", token: "a".repeat(32) }));
  assert.deepEqual(await inbound, { type: "message", peer: peer.peer, data: JSON.stringify({ type: "hello", token: "a".repeat(32) }) });
  const outbound = next(guest);
  host.send(JSON.stringify({ peer: peer.peer, data: JSON.stringify({ type: "welcome" }) }));
  assert.deepEqual(await outbound, { type: "welcome" });
  host.close(1000);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await stub.fetch("https://room/guest", { headers: { upgrade: "websocket", authorization: "Bearer " + "a".repeat(32) } })).status, 410);
  console.log("Collaboration relay: authentication, host presence, bidirectional routing and session shutdown passed.");
} finally { await mf.dispose(); }
