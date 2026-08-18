/**
 * The protocol parser, tested as the security boundary it is.
 *
 * Almost every case below is a *rejection*. That balance is deliberate: this parser's job is
 * not primarily to read well-formed messages - any `JSON.parse` does that - it is to refuse
 * everything else, and the hostile cases are the ones a happy-path test suite would never
 * generate. Each rejection here corresponds to something that becomes an operation on the
 * host's machine if it gets through: a filesystem read, a document mutation, a role change.
 *
 * The property tests at the end are the ones that matter most, because they cover the inputs
 * nobody thought to write down. `parse` must return a message or null for *any* string, and
 * must never throw - a throw inside a socket handler takes the session down, and on the host
 * that means taking everyone's session down at once.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LIMITS, PROTOCOL_VERSION, isSupportedProtocol, parse, serialise } from "@adcode/collab";
import type { Message } from "@adcode/collab";

/** A valid frame of each kind, to mutate in the tests below. */
const VALID: Record<string, unknown> = {
  hello: { type: "hello", protocol: PROTOCOL_VERSION, token: "tok", name: "Ada" },
  docOpen: { type: "doc-open", path: "src/main.ts" },
  docUpdate: { type: "doc-update", path: "src/main.ts", update: "AAAA" },
  presence: {
    type: "presence",
    participantId: null,
    path: "src/main.ts",
    cursor: { line: 3, column: 7 },
    selection: null,
  },
  setRole: { type: "set-role", participantId: "p2", role: "viewer" },
};

function parseObject(value: unknown): Message | null {
  return parse(JSON.stringify(value));
}

describe("parse: envelope", () => {
  it("reads a well-formed hello", () => {
    expect(parseObject(VALID["hello"])).toEqual({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      token: "tok",
      name: "Ada",
    });
  });

  it("refuses anything that is not a JSON object", () => {
    for (const raw of ["", "not json", "null", "42", '"a string"', "[]", "[{}]", "true"]) {
      expect(parse(raw), raw).toBeNull();
    }
  });

  it("refuses an unknown message type rather than ignoring it", () => {
    // A peer speaking a dialect this build does not know must fail loudly. Silently
    // dropping the message would leave half its intent applied.
    expect(parseObject({ type: "rm-rf", path: "src" })).toBeNull();
    expect(parseObject({ type: "" })).toBeNull();
    expect(parseObject({ type: 7 })).toBeNull();
    expect(parseObject({})).toBeNull();
  });

  it("refuses a frame larger than the cap before parsing it", () => {
    // The bound exists so a peer cannot make the host allocate arbitrarily by sending one
    // enormous line. Checked on the raw string, ahead of `JSON.parse`.
    expect(parse(`{"type":"error","detail":"${"x".repeat(LIMITS.frame)}"}`)).toBeNull();
  });
});

describe("parse: paths", () => {
  it("accepts an ordinary workspace-relative path", () => {
    expect(parseObject(VALID["docOpen"])).toEqual({ type: "doc-open", path: "src/main.ts" });
  });

  it("refuses every traversal and absolute form", () => {
    // Each of these becomes a file the host opens if it gets through. The host checks
    // `isInsideWorkspace` as well; this is the first of the two guards, not the only one.
    const hostile = [
      "../secrets.txt",
      "../../../../etc/passwd",
      "src/../../outside.ts",
      "/etc/passwd",
      "/",
      "C:/Windows/System32/config/SAM",
      "c:/windows",
      "\\\\server\\share\\file",
      "src\\main.ts",
      "./main.ts",
      "src//main.ts",
      "",
    ];

    for (const path of hostile) {
      expect(parseObject({ type: "doc-open", path }), path).toBeNull();
    }
  });

  it("refuses a NUL byte, which can truncate a path inside a syscall", () => {
    // `ok.txt\0.png` passes a check on the whole string and opens `ok.txt`. The same guard
    // `pathSafety.ts` and `liveServer.ts` both carry, for the same reason.
    expect(parseObject({ type: "doc-open", path: "ok.txt\u0000.png" })).toBeNull();
  });

  it("refuses a path past the length cap", () => {
    expect(parseObject({ type: "doc-open", path: "a".repeat(LIMITS.path + 1) })).toBeNull();
  });

  it("refuses a non-string path", () => {
    for (const path of [null, undefined, 42, {}, [], true]) {
      expect(parseObject({ type: "doc-open", path })).toBeNull();
    }
  });
});

describe("parse: document updates", () => {
  it("accepts base64", () => {
    expect(parseObject(VALID["docUpdate"])).toEqual({
      type: "doc-update",
      path: "src/main.ts",
      update: "AAAA",
    });
  });

  it("refuses payloads that are not base64", () => {
    // Handing a decoder non-base64 either throws or silently yields garbage bytes, and for a
    // Yjs update garbage bytes mean a corrupted document rather than a rejected message.
    for (const update of ["AAA", "!!!!", "AA=A", "AB CD", "≈≈≈≈", "AAAAA"]) {
      expect(parseObject({ type: "doc-update", path: "a.ts", update }), update).toBeNull();
    }
  });

  it("refuses an update past the cap", () => {
    const update = "A".repeat(LIMITS.update + 4);
    expect(parseObject({ type: "doc-update", path: "a.ts", update })).toBeNull();
  });
});

describe("parse: presence", () => {
  it("accepts a cursor with no selection", () => {
    expect(parseObject(VALID["presence"])).toEqual({
      type: "presence",
      participantId: null,
      path: "src/main.ts",
      cursor: { line: 3, column: 7 },
      selection: null,
    });
  });

  it("accepts a null path, which means nothing is open", () => {
    const parsed = parseObject({ ...VALID["presence"] as object, path: null });
    expect(parsed).toMatchObject({ type: "presence", path: null });
  });

  it("refuses a malformed path while still allowing null", () => {
    // The distinction matters: `null` is a legitimate value and a traversal is not, so they
    // must not collapse into the same "falsy path" branch.
    expect(parseObject({ ...VALID["presence"] as object, path: "../x" })).toBeNull();
  });

  it("refuses NaN and Infinity coordinates", () => {
    // JSON has no NaN literal, but a coordinate can arrive as a string or via 1e999, which
    // parses to Infinity. Either survives `typeof === "number"` and then makes every
    // comparison downstream false - a cursor that is silently nowhere.
    for (const cursor of [
      { line: 1e999, column: 1 },
      { line: 1, column: 1e999 },
      { line: 1.5, column: 1 },
      { line: 0, column: 1 },
      { line: -3, column: 1 },
      { line: "1", column: 1 },
      { line: 1 },
      {},
      null,
    ]) {
      expect(
        parseObject({ type: "presence", participantId: null, path: null, cursor, selection: null }),
        JSON.stringify(cursor),
      ).toBeNull();
    }
  });

  it("refuses a half-formed selection", () => {
    expect(
      parseObject({
        type: "presence",
        participantId: null,
        path: null,
        cursor: { line: 1, column: 1 },
        selection: { start: { line: 1, column: 1 } },
      }),
    ).toBeNull();
  });
});

describe("parse: roles", () => {
  it("accepts the two assignable roles", () => {
    expect(parseObject(VALID["setRole"])).toMatchObject({ role: "viewer" });
    expect(parseObject({ ...VALID["setRole"] as object, role: "editor" })).toMatchObject({
      role: "editor",
    });
  });

  it("refuses a message that tries to confer host", () => {
    // Refused at the shape level, so no permission check downstream has to have an opinion
    // about whether a second host is possible. A session has exactly one.
    expect(parseObject({ ...VALID["setRole"] as object, role: "host" })).toBeNull();
  });

  it("refuses an invented role", () => {
    for (const role of ["admin", "owner", "", null, 1, {}]) {
      expect(parseObject({ ...VALID["setRole"] as object, role })).toBeNull();
    }
  });
});

describe("parse: rosters", () => {
  const participant = {
    id: "p1",
    name: "Ada",
    role: "host",
    colour: "#34c759",
    terminalWrite: true,
  };

  it("accepts a roster and keeps host as a readable role", () => {
    const parsed = parseObject({ type: "roster", participants: [participant] });
    expect(parsed).toMatchObject({ type: "roster", participants: [participant] });
  });

  it("refuses a roster with a malformed member", () => {
    for (const broken of [
      { ...participant, id: "" },
      { ...participant, terminalWrite: "yes" },
      { ...participant, role: "wizard" },
      { ...participant, colour: 0x34c759 },
      {},
      null,
      "p1",
    ]) {
      expect(parseObject({ type: "roster", participants: [broken] })).toBeNull();
    }
  });

  it("refuses an implausibly large roster", () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ ...participant, id: `p${i}` }));
    expect(parseObject({ type: "roster", participants: many })).toBeNull();
  });

  it("refuses a roster that is not an array", () => {
    expect(parseObject({ type: "roster", participants: { 0: participant } })).toBeNull();
  });
});

describe("serialise", () => {
  it("round-trips every message this build can produce", () => {
    const messages: Message[] = [
      { type: "hello", protocol: PROTOCOL_VERSION, token: "t", name: "Ada" },
      { type: "refused", reason: "Wrong token." },
      { type: "doc-open", path: "a/b.ts" },
      { type: "doc-state", path: "a/b.ts", update: "AAAA" },
      { type: "doc-update", path: "a/b.ts", update: "BBBB" },
      { type: "doc-save", path: "a/b.ts" },
      { type: "doc-saved", path: "a/b.ts" },
      { type: "presence", participantId: "p2", path: "a/b.ts", cursor: { line: 2, column: 4 }, selection: null },
      { type: "presence", participantId: null, path: null, cursor: { line: 1, column: 1 }, selection: null },
      { type: "follow", participantId: null },
      { type: "follow", participantId: "p2" },
      { type: "commit-request", message: "Fix the thing" },
      { type: "commit-decision", approved: true, detail: "abc1234" },
      { type: "terminal-output", data: "$ ls\n" },
      { type: "terminal-input", data: "ls\n" },
      { type: "set-role", participantId: "p2", role: "viewer" },
      { type: "set-terminal-write", participantId: "p2", allowed: true },
      { type: "error", detail: "something" },
    ];

    for (const message of messages) {
      expect(parse(serialise(message)), message.type).toEqual(message);
    }
  });
});

describe("isSupportedProtocol", () => {
  it("accepts only this build's version", () => {
    expect(isSupportedProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocol(PROTOCOL_VERSION + 1)).toBe(false);
    expect(isSupportedProtocol(0)).toBe(false);
  });
});

describe("parse: never throws", () => {
  it("returns a message or null for any string at all", () => {
    // The property that keeps a session alive. `parse` runs inside a socket handler; a throw
    // there takes down the connection, and on the host it takes down everyone's at once.
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const result = parse(raw);
        expect(result === null || typeof result === "object").toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("survives arbitrary JSON values in the type field", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => parse(JSON.stringify({ type: value }))).not.toThrow();
      }),
    );
  });

  it("survives arbitrary objects claiming to be each known type", () => {
    const types = [
      "hello", "welcome", "refused", "roster", "set-role", "set-terminal-write",
      "doc-open", "doc-state", "doc-update", "doc-save", "doc-saved",
      "presence", "follow", "commit-request", "commit-decision",
      "terminal-output", "terminal-input", "error",
    ];

    fc.assert(
      fc.property(fc.constantFrom(...types), fc.jsonValue(), (type, body) => {
        const raw = JSON.stringify({ ...(typeof body === "object" && body !== null ? body : {}), type });
        expect(() => parse(raw)).not.toThrow();
      }),
      { numRuns: 2000 },
    );
  });
});
