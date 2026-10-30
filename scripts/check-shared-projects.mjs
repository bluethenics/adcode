import { Miniflare, convertV4MiniflareOptions } from "../apps/cloud/node_modules/miniflare/dist/src/index.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: readFileSync("apps/collab-relay/output/collab-relay-build/index.js", "utf8"), compatibilityDate: "2026-10-13", durableObjects: { ROOMS: { className: "CollabRoom", useSQLite: true }, PROJECTS: { className: "CloudProject", useSQLite: true }, PROJECT_ACCOUNTS: { className: "ProjectAccount", useSQLite: true } }, bindings: { FIREBASE_PROJECT_ID: "adcode-idle" } }));
try {
  assert.equal((await mf.dispatchFetch("https://relay/projects")).status, 401);
  assert.equal((await mf.dispatchFetch("https://relay/projects", { method: "POST", body: JSON.stringify({ paid: true, name: "Spoof" }) })).status, 401);
  const accounts = await mf.getDurableObjectNamespace("PROJECT_ACCOUNTS");
  const account = accounts.get(accounts.idFromName("owner"));
  const projects = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), name: "Project " + i, owner: "owner" }));
  const create = (project, paid = false) => account.fetch("https://account/create", { method: "POST", body: JSON.stringify({ project, paid }) });
  const results = await Promise.all(projects.map(project => create(project)));
  assert.equal(results.filter(response => response.status === 200).length, 3, "Concurrent Free creation allows exactly 3");
  assert.equal(results.filter(response => response.status === 402).length, 3);
  const owned = (await (await account.fetch("https://account/")).json()).owned;
  const fourth = projects.find(p => !owned.some(x => x.id === p.id));
  assert.equal((await create(fourth, true)).status, 200, "Verified paid entitlement permits the fourth project");
  assert.equal((await create({ id: randomUUID(), name: "Fifth", owner: "owner" })).status, 402, "Downgrade preserves owned projects but blocks new creation");
  const joined = { id: randomUUID(), name: "Friend", owner: "friend" };
  assert.equal((await account.fetch("https://account/join", { method: "POST", body: JSON.stringify({ project: joined }) })).status, 200);
  assert.equal((await (await account.fetch("https://account/")).json()).owned.length, 4, "Joining never consumes an owned slot");
  const ns = await mf.getDurableObjectNamespace("PROJECTS");
  const project = owned[0];
  const stub = ns.get(ns.idFromName(project.id));
  const call = (uid, path, method = "GET", value) => stub.fetch("https://project/" + path, { method, headers: { "x-project-user": uid, "x-project-label": uid + "@example.test" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  let meta = await (await call("owner", "create", "POST", { project })).json();
  const key = meta.invite.split(":")[2];
  const files = { "src/app.ts": Buffer.from("original").toString("base64") };
  assert.equal((await call("stranger", "files")).status, 403);
  assert.equal((await call("friend", "join", "POST", { key: "wrong" })).status, 403);
  assert.equal((await call("owner", "files", "PUT", { revision: 0, files })).status, 200);
  assert.equal((await call("friend", "join", "POST", { key })).status, 200);
  assert.deepEqual((await (await call("friend", "files")).json()).files, files, "Files are available without a host WebSocket");
  assert.equal((await call("friend", "files", "PUT", { revision: 0, files: {} })).status, 409, "Stale writes cannot overwrite a newer revision");
  for (const path of ["../escape", "C:/escape", "a\\b", ".env", ".git/config", "src/private.key", "aux.txt"]) {
    assert.equal((await call("friend", "files", "PUT", { revision: 1, files: { [path]: "" } })).status, 400, path);
  }
  assert.equal((await call("friend", "files", "PUT", { revision: 1, files: { "File.ts": "", "file.ts": "" } })).status, 400);
  assert.equal((await call("friend", "files", "PUT", { revision: 1, files: { "file": "", "file/nested": "" } })).status, 400);
  assert.equal((await call("friend", "members", "POST", { rotate: true })).status, 403);
  assert.equal((await call("owner", "members", "POST", { rotate: true })).status, 200);
  assert.equal((await call("other", "join", "POST", { key })).status, 403, "Rotating invalidates old invites");
  assert.equal((await call("friend", "files")).status, 200, "Existing members survive invite rotation");
  assert.equal((await call("friend", "files", "PUT", { revision: 1, files: { "src/app.ts": Buffer.from("edited offline from owner").toString("base64") } })).status, 200);
  assert.equal((await call("owner", "files")).status, 200);
  assert.equal((await call("owner", "members", "POST", { remove: "friend" })).status, 200);
  assert.equal((await call("friend", "files")).status, 403);
  assert.equal((await call("friend", "delete", "POST")).status, 403);
  assert.equal((await call("owner", "delete", "POST")).status, 200);
  assert.equal((await call("owner", "files")).status, 404);
  console.log("Online projects: concurrent Free quota, paid creation, membership, offline availability, revision conflicts, path safety, invite rotation and removal passed.");
} finally { await mf.dispose(); }
