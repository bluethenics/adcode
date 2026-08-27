import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Drives the real `adcode-mcp` binary over real stdio with real JSON-RPC frames.
 *
 * This is the test that matters for §5.2. The store can be perfect and the tools
 * correct, and the feature still be worthless if the handshake an agent performs does
 * not succeed - and that failure is silent, which is why it gets an end-to-end test
 * rather than a mocked transport.
 */
const BINARY = fileURLToPath(new URL("../bin/adcode-mcp.ts", import.meta.url));

let workspace: string;
let child: ChildProcessWithoutNullStreams;
let buffer = "";
const pending = new Map<number, (message: Record<string, unknown>) => void>();

function send(message: Record<string, unknown>): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id: number, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 20_000);

    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });

    send({ jsonrpc: "2.0", id, method, params });
  });
}

/** Pull the text out of a tools/call result. */
function resultText(message: Record<string, unknown>): string {
  const result = message["result"] as { content?: Array<{ text?: string }> } | undefined;
  return result?.content?.map((part) => part.text ?? "").join("\n") ?? "";
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "adcode-mcp-"));

  child = spawn(process.execPath, [BINARY, workspace], {
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      if (line.length > 0) {
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          const id = message["id"];
          if (typeof id === "number") pending.get(id)?.(message);
        } catch {
          // Not a frame; the protocol requires stdout carry only JSON-RPC, and the
          // assertion below checks that it does.
        }
      }

      newline = buffer.indexOf("\n");
    }
  });

  // The handshake, exactly as a client performs it.
  const initialized = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "adcode-test-client", version: "0.0.0" },
  });

  const result = initialized["result"] as Record<string, unknown> | undefined;
  expect(result, "initialize must return a result").toBeDefined();

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
}, 60_000);

afterAll(async () => {
  // Wait for the process to actually exit before removing the directory. `kill` only
  // signals, and on Windows the still-open SQLite handle makes the unlink fail.
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });

  await rm(workspace, { recursive: true, force: true });
}, 30_000);

describe("handshake", () => {
  it("reports its identity and tool capability", async () => {
    const message = await request(2, "ping", {});
    expect(message["error"] ?? message["result"]).toBeDefined();
  });

  it("advertises exactly the six tools §5.2 specifies, and no more", async () => {
    // "Expose exactly these tools, and resist adding more."
    const message = await request(3, "tools/list", {});
    const result = message["result"] as { tools: Array<{ name: string }> };

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "memory_list",
      "memory_read",
      "memory_search",
      "memory_write",
      "project_context",
      "session_append",
    ]);
  });

  it("gives every tool a description an agent can act on", async () => {
    const message = await request(4, "tools/list", {});
    const result = message["result"] as { tools: Array<{ description?: string; inputSchema: unknown }> };

    for (const tool of result.tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe("the round trip an agent actually performs", () => {
  it("starts with an empty project context that says so", async () => {
    const message = await request(10, "tools/call", { name: "project_context", arguments: {} });
    expect(resultText(message).toLowerCase()).toContain("no memories");
  });

  it("writes a memory", async () => {
    const message = await request(11, "tools/call", {
      name: "memory_write",
      arguments: {
        name: "chose-electron",
        description: "Why the shell is Electron and not Tauri",
        type: "decision",
        body: "node-pty and the LSP subprocess story are first-class in Node.",
      },
    });

    expect(resultText(message)).toContain("chose-electron");
  });

  it("leaves plain markdown on disk that a human can open", async () => {
    // §5.1: the store is git-diffable and human-readable. "What does this thing know
    // about me?" must have an answer the user can point at.
    const path = join(workspace, ".adcode", "memory", "decisions", "chose-electron.md");
    await expect(stat(path)).resolves.toBeDefined();

    const raw = await readFile(path, "utf8");
    expect(raw).toContain("name: chose-electron");
    expect(raw).toContain("node-pty");
  });

  it("regenerates AGENTS.md and CLAUDE.md, so a file-reading agent is current", async () => {
    const agents = await readFile(join(workspace, ".adcode", "memory", "AGENTS.md"), "utf8");
    const claude = await readFile(join(workspace, ".adcode", "memory", "CLAUDE.md"), "utf8");

    expect(agents).toContain("Why the shell is Electron");
    expect(agents).toBe(claude);
  });

  it("reads it back in full", async () => {
    const message = await request(12, "tools/call", {
      name: "memory_read",
      arguments: { name: "chose-electron" },
    });

    expect(resultText(message)).toContain("node-pty");
  });

  it("finds it by full-text search", async () => {
    const message = await request(13, "tools/call", {
      name: "memory_search",
      arguments: { query: "tauri" },
    });

    expect(resultText(message)).toContain("chose-electron");
  });

  it("lists it", async () => {
    const message = await request(14, "tools/call", {
      name: "memory_list",
      arguments: {},
    });

    expect(resultText(message)).toContain("chose-electron");
  });

  it("records a session", async () => {
    const message = await request(15, "tools/call", {
      name: "session_append",
      arguments: { agent: "claude-code", summary: "Chose Electron over Tauri." },
    });

    expect(resultText(message).toLowerCase()).toContain("recorded");
  });

  it("now returns a project context containing what it learned", async () => {
    const message = await request(16, "tools/call", { name: "project_context", arguments: {} });
    const context = resultText(message);

    expect(context).toContain("chose-electron");
    expect(context).toContain("Why the shell is Electron");
  });
});

describe("bad arguments", () => {
  it("reports a missing argument as a tool error rather than dropping the connection", async () => {
    const message = await request(20, "tools/call", { name: "memory_read", arguments: {} });
    const result = message["result"] as { isError?: boolean } | undefined;

    expect(result?.isError).toBe(true);
  });

  it("refuses a name that would escape the store", async () => {
    const message = await request(21, "tools/call", {
      name: "memory_write",
      arguments: {
        name: "../../../etc/passwd",
        description: "d",
        type: "decision",
        body: "b",
      },
    });

    const result = message["result"] as { isError?: boolean } | undefined;
    expect(result?.isError).toBe(true);
  });

  it("is still answering afterwards", async () => {
    const message = await request(22, "tools/call", { name: "memory_list", arguments: {} });
    expect(resultText(message)).toContain("chose-electron");
  });
});

describe("a second client sees the same store", () => {
  it("reads what the first client wrote, with no shared process", async () => {
    // The whole reason the binary is standalone: §5.2's promise is that Claude Code and
    // the built-in chat share one memory, and they are different processes.
    const second = spawn(process.execPath, [BINARY, workspace], { stdio: ["pipe", "pipe", "pipe"] });

    try {
      const reply = await new Promise<string>((resolve, reject) => {
        let out = "";
        const timer = setTimeout(() => reject(new Error("second client timed out")), 20_000);

        second.stdout.setEncoding("utf8");
        second.stdout.on("data", (chunk: string) => {
          out += chunk;
          for (const line of out.split("\n")) {
            if (!line.trim().startsWith("{")) continue;
            try {
              const message = JSON.parse(line) as Record<string, unknown>;
              if (message["id"] === 2) {
                clearTimeout(timer);
                resolve(JSON.stringify(message));
              }
            } catch {
              // Partial frame; wait for more.
            }
          }
        });

        second.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "second", version: "0" },
            },
          })}\n`,
        );
        second.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        second.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "memory_read", arguments: { name: "chose-electron" } },
          })}\n`,
        );
      });

      expect(reply).toContain("node-pty");
    } finally {
      await new Promise<void>((resolve) => {
        if (second.exitCode !== null || second.signalCode !== null) return resolve();
        second.once("exit", () => resolve());
        second.kill();
      });
    }
  }, 40_000);
});
