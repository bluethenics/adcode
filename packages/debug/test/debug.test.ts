import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  debugSupportFor,
  describeValue,
  fileUrlToPath,
  framesFrom,
  pathToFileUrl,
  pauseReasonOf,
  propertiesFrom,
  samePath,
  scopesFrom,
} from "@adcode/debug";

describe("paths", () => {
  /*
   * The reason this file exists. A breakpoint set on a path that does not match the URL
   * Node reports never hits, and never says why.
   */
  it("spells a Windows path the way the inspector does", () => {
    expect(pathToFileUrl("E:\\adcode\\main.ts")).toBe("file:///E:/adcode/main.ts");
  });

  it("upper-cases the drive letter", () => {
    // Node reports `file:///E:/...`; a breakpoint requested for `e:` matches nothing.
    expect(pathToFileUrl("e:\\a\\b.ts")).toBe("file:///E:/a/b.ts");
  });

  it("handles a POSIX path", () => {
    expect(pathToFileUrl("/home/user/main.ts")).toBe("file:///home/user/main.ts");
  });

  it("encodes a space", () => {
    expect(pathToFileUrl("/home/my code/a.ts")).toBe("file:///home/my%20code/a.ts");
  });

  it("comes back to a Windows path", () => {
    expect(fileUrlToPath("file:///E:/adcode/main.ts")).toBe("E:\\adcode\\main.ts");
  });

  it("comes back to a POSIX path", () => {
    expect(fileUrlToPath("file:///home/user/main.ts")).toBe("/home/user/main.ts");
  });

  it("decodes on the way back", () => {
    expect(fileUrlToPath("file:///home/my%20code/a.ts")).toBe("/home/my code/a.ts");
  });

  it("refuses a url that is not a file", () => {
    // Node reports its own internals like this, and turning them into paths sends the user
    // to a file that does not exist.
    expect(fileUrlToPath("node:internal/modules/cjs/loader")).toBeNull();
    expect(fileUrlToPath("")).toBeNull();
  });

  it("round-trips any absolute path", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z0-9 _.-]{1,12}$/), { minLength: 1, maxLength: 5 }),
        (segments) => {
          const path = `/${segments.join("/")}`;
          expect(fileUrlToPath(pathToFileUrl(path))).toBe(path);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("compares paths the way the platform does", () => {
    expect(samePath("E:\\A\\b.ts", "e:/a/B.ts".replace("B", "b"), "win32")).toBe(true);
    expect(samePath("/a/B.ts", "/a/b.ts", "linux")).toBe(false);
  });
});

describe("pauseReasonOf", () => {
  /* CDP says `other` for an ordinary breakpoint hit, which is worth translating once. */
  it("reads a breakpoint hit", () => {
    expect(pauseReasonOf("other")).toBe("breakpoint");
  });

  it("reads the rest", () => {
    expect(pauseReasonOf("step")).toBe("step");
    expect(pauseReasonOf("exception")).toBe("exception");
    expect(pauseReasonOf("promiseRejection")).toBe("exception");
    expect(pauseReasonOf("Break on start")).toBe("entry");
    expect(pauseReasonOf(undefined)).toBe("other");
  });
});

describe("framesFrom", () => {
  const paused = {
    callFrames: [
      {
        callFrameId: "0",
        functionName: "greet",
        url: "file:///E:/app/main.ts",
        location: { scriptId: "7", lineNumber: 4, columnNumber: 2 },
      },
      {
        callFrameId: "1",
        functionName: "",
        url: "",
        location: { scriptId: "9", lineNumber: 0, columnNumber: 0 },
      },
    ],
  };

  it("turns zero-based positions into editor ones", () => {
    // Off by one here puts every breakpoint a line above where the user put it.
    const [frame] = framesFrom(paused, () => undefined);
    expect(frame?.line).toBe(5);
    expect(frame?.column).toBe(3);
  });

  it("resolves the path", () => {
    expect(framesFrom(paused, () => undefined)[0]?.path).toBe("E:\\app\\main.ts");
  });

  it("names an anonymous function", () => {
    expect(framesFrom(paused, () => undefined)[1]?.name).toBe("(anonymous)");
  });

  it("falls back to the script's announced url", () => {
    const frames = framesFrom(paused, (id) => (id === "9" ? "file:///E:/app/other.ts" : undefined));
    expect(frames[1]?.path).toBe("E:\\app\\other.ts");
  });

  it("gives a null path to a frame with no file", () => {
    expect(framesFrom(paused, () => undefined)[1]?.path).toBeNull();
  });

  it("survives nonsense", () => {
    expect(framesFrom(null, () => undefined)).toEqual([]);
    expect(framesFrom({ callFrames: "no" }, () => undefined)).toEqual([]);
    expect(framesFrom({ callFrames: [{}, 7, null] }, () => undefined)).toEqual([]);
  });
});

describe("scopesFrom", () => {
  it("reads the scope chain in order", () => {
    const scopes = scopesFrom({
      scopeChain: [
        { type: "local", object: { objectId: "a" } },
        { type: "closure", name: "outer", object: { objectId: "b" } },
        { type: "global", object: { objectId: "c" } },
      ],
    });

    expect(scopes.map((scope) => scope.name)).toEqual(["Local", "outer", "Global"]);
    expect(scopes[0]?.objectId).toBe("a");
  });

  it("survives nonsense", () => {
    expect(scopesFrom(null)).toEqual([]);
    expect(scopesFrom({ scopeChain: 4 })).toEqual([]);
  });
});

describe("describeValue", () => {
  it("quotes a string", () => {
    // Unquoted, a string is indistinguishable from an identifier in a list of values.
    expect(describeValue({ type: "string", value: "hi" }).value).toBe('"hi"');
  });

  it("reads the primitives", () => {
    expect(describeValue({ type: "number", value: 42 }).value).toBe("42");
    expect(describeValue({ type: "boolean", value: false }).value).toBe("false");
    expect(describeValue({ type: "undefined" }).value).toBe("undefined");
    expect(describeValue({ type: "object", subtype: "null" }).value).toBe("null");
  });

  it("keeps the handle for something expandable", () => {
    const described = describeValue({ type: "object", description: "Array(3)", objectId: "x" });
    expect(described.value).toBe("Array(3)");
    expect(described.objectId).toBe("x");
  });

  it("survives nonsense", () => {
    expect(describeValue(null).type).toBe("unknown");
  });
});

describe("propertiesFrom", () => {
  it("reads properties as rows", () => {
    const rows = propertiesFrom({
      result: [
        { name: "count", value: { type: "number", value: 3 } },
        { name: "label", value: { type: "string", value: "x" } },
      ],
    });

    expect(rows).toEqual([
      { name: "count", value: "3", type: "number" },
      { name: "label", value: '"x"', type: "string" },
    ]);
  });

  /*
   * Calling a getter to fill a panel is how a debugger changes the program it is meant to
   * be observing.
   */
  it("does not invoke a getter", () => {
    const rows = propertiesFrom({ result: [{ name: "size", get: { type: "function" } }] });
    expect(rows[0]).toEqual({ name: "size", value: "(getter)", type: "accessor" });
  });

  it("survives nonsense", () => {
    expect(propertiesFrom(undefined)).toEqual([]);
    expect(propertiesFrom({ result: [null, 3, {}] })).toEqual([]);
  });
});

describe("debugSupportFor", () => {
  it("needs nothing for JavaScript and TypeScript", () => {
    expect(debugSupportFor("typescript")?.requires).toBeNull();
  });

  it("names what Python needs and how to get it", () => {
    expect(debugSupportFor("python")?.requires).toBe("debugpy");
    expect(debugSupportFor("python")?.install).toBe("pip install debugpy");
  });

  it("says nothing for a language it cannot debug", () => {
    expect(debugSupportFor("rust")).toBeNull();
  });
});
