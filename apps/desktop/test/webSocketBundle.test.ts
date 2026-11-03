import { builtinModules } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import { mainCommonjsOptions } from "../electron.vite.config.ts";

it("imports bundled ws without optional native peers and exchanges real WebSocket frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adcode-ws-bundle-"));
  try {
    // Resolve ws from this checkout, while keeping generated files in a temporary folder.
    const entry = join(directory, "entry.mjs");
    await writeFile(entry, `export { default, WebSocketServer } from ${JSON.stringify(resolve(import.meta.dirname, "../../..", "node_modules/ws/wrapper.mjs"))};`);
    await build({ configFile: false, logLevel: "silent", build: {
      commonjsOptions: mainCommonjsOptions,
      outDir: join(directory, "out"), minify: false,
      lib: { entry, formats: ["es"], fileName: () => "ws.mjs" },
      rollupOptions: { external: [...builtinModules, ...builtinModules.map(name => `node:${name}`)] },
    } });
    // A fresh Node process evaluates emitted ESM without Vitest's source transform.
    const runner = join(directory, "verify.mjs");
    await writeFile(runner, `
      import assert from 'node:assert/strict';
      import WebSocket, { WebSocketServer } from './out/ws.mjs';
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      await new Promise((ready, reject) => { server.once('listening', ready); server.once('error', reject); });
      server.on('connection', peer => peer.on('message', message => peer.send(message)));
      const client = new WebSocket('ws://127.0.0.1:' + server.address().port);
      const message = 'Shared project · 合作 🚀 '.repeat(100);
      const received = new Promise((ready, reject) => { client.once('message', data => ready(data.toString())); client.once('error', reject); });
      await new Promise((ready, reject) => { client.once('open', ready); client.once('error', reject); });
      client.send(message);
      assert.equal(await received, message);
      client.terminate();
      for (const peer of server.clients) peer.terminate();
      await new Promise(done => server.close(done));
      console.log('BUNDLED_WS_OK');
    `);
    const result = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    expect(result.status, result.stdout + result.stderr || String(result.error)).toBe(0);
    expect(result.stdout).toContain("BUNDLED_WS_OK");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
