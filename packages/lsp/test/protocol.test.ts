import { describe, it, expect } from "vitest";
import {
  initializeParams,
  pathToUri,
  positionParams,
  severityFor,
  toDiagnostic,
  toEditorColumn,
  toEditorLine,
  toLspPosition,
  uriToPath,
} from "../src/index.ts";

describe("position conversion", () => {
  it("moves between zero-based wire positions and one-based human ones", () => {
    expect(toEditorLine(0)).toBe(1);
    expect(toEditorColumn(0)).toBe(1);
    expect(toLspPosition(1, 1)).toEqual({ line: 0, character: 0 });
  });

  it("round-trips", () => {
    for (const [line, column] of [[1, 1], [12, 7], [400, 120]] as const) {
      const wire = toLspPosition(line, column);
      expect([toEditorLine(wire.line), toEditorColumn(wire.character)]).toEqual([line, column]);
    }
  });

  it("clamps rather than sending a negative position", () => {
    // A zero or negative line reaching a server is a protocol violation, and several
    // servers respond by closing the connection rather than by complaining.
    expect(toLspPosition(0, 0)).toEqual({ line: 0, character: 0 });
    expect(toLspPosition(-5, -5)).toEqual({ line: 0, character: 0 });
  });
});

describe("severityFor", () => {
  it("maps the four the protocol defines", () => {
    expect(severityFor(1)).toBe("error");
    expect(severityFor(2)).toBe("warning");
    expect(severityFor(3)).toBe("info");
    expect(severityFor(4)).toBe("info");
  });

  it("treats an unranked diagnostic as an error", () => {
    // The spec leaves it to the client. A server that bothered to report something and did
    // not rank it is likelier to have found a problem than a note.
    expect(severityFor(undefined)).toBe("error");
  });

  it("does not invent a rank for a number it does not know", () => {
    expect(severityFor(99)).toBe("info");
  });
});

describe("toDiagnostic", () => {
  it("produces the shape the Problems panel already draws", () => {
    const result = toDiagnostic(
      {
        range: { start: { line: 11, character: 6 }, end: { line: 11, character: 9 } },
        severity: 1,
        code: "reportUndefinedVariable",
        message: "\"foo\" is not defined",
      },
      "app.py",
      "pyright",
    );

    expect(result).toEqual({
      file: "app.py",
      line: 12,
      column: 7,
      endLine: 12,
      endColumn: 10,
      severity: "error",
      source: "pyright",
      code: "reportUndefinedVariable",
      message: '"foo" is not defined',
    });
  });

  it("stringifies a numeric code, since the table is keyed on strings", () => {
    const result = toDiagnostic(
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, code: 2322, message: "x" },
      "a.rs",
      "rust-analyzer",
    );

    expect(result.code).toBe("2322");
  });

  it("uses the server id rather than whatever the server calls itself", () => {
    // The explanation table is keyed on a family we control. A server that renames its own
    // `source` between releases would otherwise orphan every entry keyed to it.
    const result = toDiagnostic(
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        source: "basedpyright",
        message: "x",
      },
      "a.py",
      "pyright",
    );

    expect(result.source).toBe("pyright");
  });

  it("carries an absent code as empty rather than as the string 'undefined'", () => {
    const result = toDiagnostic(
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "x" },
      "a.py",
      "pyright",
    );

    expect(result.code).toBe("");
  });
});

describe("pathToUri and uriToPath", () => {
  it("round-trips a POSIX path", () => {
    expect(uriToPath(pathToUri("/home/dev/app/main.py"))).toBe("/home/dev/app/main.py");
  });

  it("round-trips a Windows path, dropping the URI's leading slash", () => {
    // `file:///C%3A/work/app.py` decodes to `/C:/work/app.py`, and the leading slash is
    // part of the URI rather than the path. Left on, nothing on disk matches it.
    expect(uriToPath(pathToUri("C:\\work\\app.py"))).toBe("C:/work/app.py");
  });

  it("encodes a Windows drive colon the way every other client does", () => {
    expect(pathToUri("C:\\work\\app.py")).toBe("file:///C%3A/work/app.py");
  });

  it("survives a path with a space or a hash in it", () => {
    // Not encoding these produces a URI different from the one the server echoes back, and
    // the diagnostics then land against a document nobody is looking at.
    const path = "/home/dev/my project/a#b.py";

    expect(pathToUri(path)).toContain("my%20project");
    expect(uriToPath(pathToUri(path))).toBe(path);
  });

  it("round-trips non-ASCII in a filename", () => {
    expect(uriToPath(pathToUri("/home/dev/café/main.py"))).toBe("/home/dev/café/main.py");
  });
});

describe("initializeParams", () => {
  it("announces only capabilities the client actually implements", () => {
    // Over-claiming is how a server ends up sending requests nobody answers - and several
    // of them block on the reply, so it presents as a hang rather than as a mistake.
    const params = initializeParams("/home/dev/app", 1234) as {
      capabilities: { textDocument: Record<string, unknown>; workspace: Record<string, unknown> };
      rootUri: string;
    };

    expect(Object.keys(params.capabilities.textDocument).sort()).toEqual([
      "completion",
      "hover",
      "publishDiagnostics",
      "synchronization",
    ]);
    expect(params.capabilities.workspace["configuration"]).toBe(false);
    expect(params.rootUri).toBe("file:///home/dev/app");
  });
});

describe("positionParams", () => {
  it("sends the cursor where the protocol expects it", () => {
    expect(positionParams("file:///a.py", 3, 5)).toEqual({
      textDocument: { uri: "file:///a.py" },
      position: { line: 2, character: 4 },
    });
  });
});
