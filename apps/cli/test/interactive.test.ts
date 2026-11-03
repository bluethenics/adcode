import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node-pty";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripAnsi } from "../src/tui/ansi.ts";
import { REPOSITORY_ROOT } from "../src/util/paths.ts";
import { removeDir, seedTagflow, tempDir } from "./helpers.ts";

const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
const server = createServer(async (request, response) => {
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += String(chunk);
  requests.push(JSON.parse(body));
  response.writeHead(200, { "content-type": "text/event-stream" });
  const content = `Terminal test reply ${requests.length}`;
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 4 } })}\n\n`);
  response.end("data: [DONE]\n\n");
});
let origin = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

function terminal() {
  const data = tempDir();
  const desktop = tempDir();
  seedTagflow(data);
  const child = spawn(process.execPath, [join(REPOSITORY_ROOT, "scripts/adcode.mjs"), "--no-ads", "--no-motion"], {
    name: "xterm-256color", cols: 100, rows: 30, cwd: REPOSITORY_ROOT,
    env: { ...process.env, NO_COLOR: "1", ADCODE_CLI_ASCII: "1", ADCODE_CLI_DATA_DIR: data, ADCODE_DESKTOP_DATA_DIR: desktop, ADCODE_AD_SERVER: origin },
  });
  let text = "";
  let exited = false;
  child.onData((chunk) => { text += stripAnsi(chunk); });
  const exit = new Promise<number>((resolve) => child.onExit((event) => { exited = true; resolve(event.exitCode); }));
  const waitFor = async (predicate: (value: string) => boolean): Promise<void> => {
    const until = Date.now() + 8_000;
    while (!predicate(text)) {
      if (exited || Date.now() > until) throw new Error(`Terminal did not reach the expected state:\n${text.slice(-4000)}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  return {
    child, data, waitFor,
    exit: async () => {
      let timeout: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([exit, new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            let running = true;
            try { process.kill(child.pid, 0); } catch { running = false; }
            reject(new Error(`Terminal did not close (process running: ${running}):\n${text.slice(-2500)}`));
          }, 5_000);
        })]);
      } finally { clearTimeout(timeout); }
    },
    clear: () => { text = ""; },
    isOpen: () => !exited,
    cleanup: () => { if (!exited) child.kill(); removeDir(data); removeDir(desktop); },
  };
}

describe("the real terminal opening flow", () => {
  it("keeps a home-screen question and follow-up in one saved interactive conversation", async () => {
    requests.length = 0;
    const app = terminal();
    try {
      await app.waitFor((text) => text.includes("Ask ADCode anything"));
      // Exercise cursor editing rather than only appending to the prompt.
      app.child.write("helo\x1b[D\x1b[Dl\x1b[F\r");
      await app.waitFor((text) => text.includes("Terminal test reply 1"));
      expect(app.isOpen()).toBe(true);
      expect(JSON.stringify(requests[0]?.messages)).toContain("hello");
      app.clear();
      app.child.write("follow up\r");
      await app.waitFor((text) => text.includes("Terminal test reply 2"));
      expect(requests[1]?.messages.filter((message) => message.role === "user")).toHaveLength(2);
      const files = readdirSync(join(app.data, "sessions"));
      expect(files).toHaveLength(1);
      const saved = JSON.parse(readFileSync(join(app.data, "sessions", files[0]!), "utf8"));
      expect(saved.messages).toHaveLength(4);
      app.child.write("\x04");
      expect([0, undefined]).toContain(await app.exit());
    } finally { app.cleanup(); }
  }, 20_000);

  it("returns from the model picker to home and survives a small terminal resize", async () => {
    const app = terminal();
    try {
      await app.waitFor((text) => text.includes("Ask ADCode anything"));
      app.clear();
      app.child.write("\t");
      await app.waitFor((text) => /MODELS|Choose a model|Filter models/.test(text));
      app.clear();
      app.child.write("\x1b");
      await app.waitFor((text) => text.includes("Ask ADCode anything"));
      app.clear();
      app.child.resize(32, 12);
      await app.waitFor((text) => text.includes("ADCODE"));
      app.child.write("\x04");
      expect([0, undefined]).toContain(await app.exit());
    } finally { app.cleanup(); }
  }, 20_000);
});
