import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpFor } from "@adcode/help";
import {
  classifyNode,
  MCP_NODE_MINIMUM,
  MCP_NODE_REQUIREMENT,
  mcpNodeNote,
  nodeRunsMcpServer,
} from "../src/shared/mcpNode.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("which Node.js can start the MCP server", () => {
  /*
   * `node:sqlite` loads without a flag from 22.13 on the 22 line and from 23.4 on the 23
   * line. 23.0-23.3 are numerically newer than 22.13 and still cannot, which is why this is
   * not a single version comparison.
   */
  it.each([
    ["v18.20.4", false],
    ["v20.18.1", false],
    ["v22.5.0", false],
    ["v22.12.0", false],
    ["v22.13.0", true],
    ["v22.20.1", true],
    ["v23.3.0", false],
    ["v23.4.0", true],
    ["v24.0.0", true],
    ["v26.1.2", true],
  ])("%s -> %s", (version, expected) => {
    expect(nodeRunsMcpServer(version)).toBe(expected);
  });

  it("reads what `node --version` prints, newline and all", () => {
    expect(nodeRunsMcpServer("v24.1.0\r\n")).toBe(true);
    expect(classifyNode("v24.1.0\r\n")).toEqual({ status: "ok", version: "v24.1.0" });
    expect(classifyNode("v20.11.1\n")).toEqual({ status: "old", version: "v20.11.1" });
  });

  it("tells no node apart from a node it could not read", () => {
    expect(classifyNode(null)).toEqual({ status: "missing" });
    expect(classifyNode("")).toEqual({ status: "unknown" });
    expect(classifyNode("not a version")).toEqual({ status: "unknown" });
    expect(nodeRunsMcpServer("not a version")).toBeNull();
  });
});

describe("what the cards say about it", () => {
  it("says nothing extra when Node.js is fine or could not be checked", () => {
    expect(mcpNodeNote({ status: "ok", version: "v24.1.0" })).toBeNull();
    expect(mcpNodeNote({ status: "unknown" })).toBeNull();
  });

  it("names the floor and where to get Node.js when it is missing", () => {
    const note = mcpNodeNote({ status: "missing" }) ?? "";
    expect(note).toContain(`Node.js ${MCP_NODE_MINIMUM} or newer`);
    expect(note).toContain("nodejs.org");
  });

  it("names the version it found when that version is too old", () => {
    const note = mcpNodeNote({ status: "old", version: "v20.11.1" }) ?? "";
    expect(note).toContain("v20.11.1");
    expect(note).toContain(`Node.js ${MCP_NODE_MINIMUM} or newer`);
  });

  it("states the requirement wherever the command is shown", () => {
    expect(MCP_NODE_REQUIREMENT).toContain(`Node.js ${MCP_NODE_MINIMUM} or newer`);
  });
});

/*
 * The help entry and the web guide are literal text - the docs seed generator reads them
 * with regexes, so they cannot interpolate the constant. This is what keeps them saying the
 * same version the app checks for, and keeps the old "that is the whole setup" from coming
 * back while it is still untrue.
 */
describe("the docs state the same requirement", () => {
  it("in the help entry", () => {
    const how = helpFor("adcode.ai.mcpServer")?.how ?? "";
    expect(how).toContain(`Node.js ${MCP_NODE_MINIMUM} or newer`);
    expect(how).not.toMatch(/whole setup|entire setup/i);
  });

  it("in the web guide", () => {
    const source = readFileSync(join(ROOT, "apps", "web", "src", "lib", "docsGuides.ts"), "utf8");
    const start = source.indexOf('"ai-mcp-server": {');
    expect(start, "the ai-mcp-server guide is gone").toBeGreaterThan(-1);
    const guide = source.slice(start, source.indexOf("\n  },", start));

    expect(guide).toContain(`Node.js ${MCP_NODE_MINIMUM} or newer`);
    expect(guide).not.toMatch(/whole setup|entire setup/i);
  });
});
