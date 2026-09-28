/**
 * Tool access is how "a Reviewer never writes files" becomes true rather than a promise in an
 * instructions box. The renderer sends a profile's access; the main process filters the tools
 * the agent is built with. These tests pin the one property that matters: the filter only ever
 * removes tools - it can never hand an agent a tool its access did not name.
 */
import { describe, expect, it } from "vitest";
import { filterToolsByAccess, parseToolAccess, READ_ONLY_TOOL_NAMES } from "../src/toolAccess.ts";

const tools = ["read_file", "list_files", "search", "propose_edit", "edit_file", "glob_files", "get_outline", "run_command", "fetch_url", "project_context"].map((name) => ({ name }));

describe("tool access", () => {
  it("keeps every tool for all", () => {
    expect(filterToolsByAccess(tools, "all").tools).toEqual(tools);
  });

  it("drops anything that writes, runs or fetches for read-only", () => {
    const names = filterToolsByAccess(tools, "read-only").tools.map((tool) => tool.name);
    expect(names).toEqual(["read_file", "list_files", "search", "glob_files", "get_outline", "project_context"]);
    expect(names).not.toContain("edit_file");
    expect(names).not.toContain("run_command");
    expect(READ_ONLY_TOOL_NAMES).not.toContain("propose_edit");
  });

  it("keeps exactly the named known tools and reports the unknown ones", () => {
    const result = filterToolsByAccess(tools, ["search", "edit_file", "delete_everything"]);
    expect(result.tools.map((tool) => tool.name)).toEqual(["search", "edit_file"]);
    expect(result.unknown).toEqual(["delete_everything"]);
  });

  it("gives an empty list no tools at all", () => {
    expect(filterToolsByAccess(tools, []).tools).toEqual([]);
  });

  it("parses the three shapes and rejects everything else", () => {
    expect(parseToolAccess("all")).toBe("all");
    expect(parseToolAccess("read-only")).toBe("read-only");
    expect(parseToolAccess(["search", "read_file", "search"])).toEqual(["search", "read_file"]);
    expect(parseToolAccess("everything")).toBeNull();
    expect(parseToolAccess([42])).toBeNull();
    expect(parseToolAccess(["bad name!"])).toBeNull();
    expect(parseToolAccess(Array.from({ length: 65 }, (_, index) => `tool_${index}`))).toBeNull();
  });
});
