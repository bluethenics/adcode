import { describe, expect, it } from "vitest";
import {
  EVENT_CODES,
  LaunchBudget,
  FRICTION_PER_LAUNCH,
  MAX_PENDING_EVENTS,
  RETENTION_EVENTS,
  cliFailureOf,
  enqueueEvent,
  isAllowedCode,
  sanitizeEvent,
  type RetentionEvent,
} from "@adcode/retention";

const AT = Date.UTC(2026, 10, 20, 12);

describe("the event vocabulary", () => {
  it("names every event once, each with a code rule", () => {
    expect(new Set(RETENTION_EVENTS).size).toBe(RETENTION_EVENTS.length);
    for (const name of RETENTION_EVENTS) expect(EVENT_CODES).toHaveProperty(name);
  });

  it("allows only short lower-case codes, so no code can carry a path, a name or a sentence", () => {
    for (const name of RETENTION_EVENTS) {
      const codes = EVENT_CODES[name];
      if (!Array.isArray(codes)) continue;
      for (const code of codes) expect(code).toMatch(/^[a-z0-9][a-z0-9._-]{0,39}$/);
    }
  });
});

describe("sanitizeEvent", () => {
  it("keeps exactly name, at, code and ms", () => {
    expect(sanitizeEvent({ name: "turn_failed", at: AT, code: "auth", ms: 1234.6, prompt: "secret", path: "C:/x" }))
      .toEqual({ name: "turn_failed", at: AT, code: "auth", ms: 1235 });
  });

  it("refuses unknown names, codes outside the list, and codes on events that take none", () => {
    expect(sanitizeEvent({ name: "file_opened", at: AT })).toBeNull();
    expect(sanitizeEvent({ name: "turn_failed", at: AT, code: "C:\\Users\\me\\secret.ts" })).toBeNull();
    expect(sanitizeEvent({ name: "turn_failed", at: AT, code: "HTTP 401 invalid key sk-123" })).toBeNull();
    expect(sanitizeEvent({ name: "ai_message", at: AT, code: "hello" })).toBeNull();
    expect(sanitizeEvent({ name: "ai_message", at: -1 })).toBeNull();
    expect(sanitizeEvent({ name: "ai_message", at: AT, ms: -5 })).toBeNull();
    expect(sanitizeEvent(null)).toBeNull();
  });

  it("checks versions by shape and caps durations at a day", () => {
    expect(isAllowedCode("session_start", "2.6.3")).toBe(true);
    expect(isAllowedCode("session_start", "2.7.0-beta.1")).toBe(true);
    expect(isAllowedCode("session_start", "my-project")).toBe(false);
    expect(sanitizeEvent({ name: "session_end", at: AT, code: "quit", ms: 9e12 })?.ms).toBe(86_400_000);
  });

  it("accepts every CLI failure as cli.kind", () => {
    expect(isAllowedCode("cli_failed", "opencode.stopped_part_way")).toBe(true);
    expect(isAllowedCode("cli_failed", "opencode.whatever")).toBe(false);
  });
});

describe("cliFailureOf", () => {
  it("names a missing CLI, a signed-out one, a failure, a silent stop and an empty answer", () => {
    expect(cliFailureOf({ error: "OpenCode: opencode was not found on this computer. Install it", answer: "", cancelled: false })).toBe("missing");
    expect(cliFailureOf({ error: "Claude Code: not logged in. Sign in by running `claude` in a terminal", answer: "", cancelled: false })).toBe("signed_out");
    expect(cliFailureOf({ error: "Codex CLI: it exited with code 1", answer: "", cancelled: false })).toBe("failed");
    expect(cliFailureOf({ error: null, answer: "Reading files.\n\nOpenCode ended its run straight after a tool call, without an answer. Say \"continue\"", cancelled: false })).toBe("stopped_part_way");
    expect(cliFailureOf({ error: null, answer: "OpenCode stopped: in a chat it cannot ask you, so it turned down", cancelled: false })).toBe("stopped_part_way");
    expect(cliFailureOf({ error: null, answer: "  ", cancelled: false })).toBe("empty");
    expect(cliFailureOf({ error: null, answer: "Done.", cancelled: false })).toBeNull();
    expect(cliFailureOf({ error: "anything", answer: "", cancelled: true })).toBeNull();
  });
});

describe("LaunchBudget", () => {
  it("sends a funnel step once per launch and day_active once per day", () => {
    const budget = new LaunchBudget();
    expect(budget.admit({ name: "ai_message", at: AT })).not.toBeNull();
    expect(budget.admit({ name: "ai_message", at: AT + 1 })).toBeNull();
    expect(budget.admit({ name: "day_active", at: AT })).not.toBeNull();
    expect(budget.admit({ name: "day_active", at: AT + 3_600_000 })).toBeNull();
    expect(budget.admit({ name: "day_active", at: AT + 86_400_000 })).not.toBeNull();
  });

  it("caps each kind of friction per launch, counting codes apart", () => {
    const budget = new LaunchBudget();
    let admitted = 0;
    for (let i = 0; i < 50; i += 1) if (budget.admit({ name: "turn_failed", at: AT + i, code: "network" })) admitted += 1;
    expect(admitted).toBe(FRICTION_PER_LAUNCH);
    expect(budget.admit({ name: "turn_failed", at: AT, code: "auth" })).not.toBeNull();
  });

  it("drops what is not a retention event", () => {
    expect(new LaunchBudget().admit({ name: "turn_failed", at: AT, code: "free text" })).toBeNull();
  });
});

describe("enqueueEvent", () => {
  it("keeps the earliest events when the queue is full", () => {
    let pending: RetentionEvent[] = [];
    for (let i = 0; i < MAX_PENDING_EVENTS + 10; i += 1) pending = enqueueEvent(pending, { name: "ai_message", at: AT + i });
    expect(pending).toHaveLength(MAX_PENDING_EVENTS);
    expect(pending[0]!.at).toBe(AT);
  });
});
