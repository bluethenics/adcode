// ADCode's own agent on a real task, against the benchmark proxy: the real loop (createAgent),
// the real OpenAI-compatible provider, the real file and command tools (createAiToolRunner) and
// the chat's real tool list, deferred tools and host context - what the desktop chat sends, minus
// the Electron window around it. Usage: node adcode.mjs <projectDir> <baseUrl> <prompt>
import { createAgent, DEFAULT_SYSTEM } from "E:/adcode-sourcecode/packages/ai/src/agent.ts";
import { createOpenAiCompatibleProvider } from "E:/adcode-sourcecode/packages/ai/src/providers/openaiCompatible.ts";
import { BUILT_IN_TOOLS } from "E:/adcode-sourcecode/packages/ai/src/tools.ts";
import { CHAT_FORK_TOOLS, AUTO_FORK_GUIDANCE } from "E:/adcode-sourcecode/packages/ai/src/chatForks.ts";
import { DELEGATE_TASK } from "E:/adcode-sourcecode/packages/ai/src/subagents.ts";
import { CREATE_AGENT } from "E:/adcode-sourcecode/packages/ai/src/taskAgents.ts";
import { DEFERRED_TOOL_NAMES } from "E:/adcode-sourcecode/packages/ai/src/toolLoading.ts";
import { modToolDefinition } from "E:/adcode-sourcecode/packages/community/src/mods.ts";
import { ASSISTANT_EXTENSION_TOOLS } from "E:/adcode-sourcecode/apps/desktop/src/main/assistantControlsService.ts";
import { BUILTIN_SKILL_TOOL, builtinSkillGuidance } from "E:/adcode-sourcecode/apps/desktop/src/main/builtinSkills.ts";
import { adcodeAppToolsFor } from "E:/adcode-sourcecode/apps/desktop/src/main/adcodeAppTools.ts";
import { createAiToolRunner } from "E:/adcode-sourcecode/apps/desktop/src/main/aiTools.ts";
import { aiWorkspaceContext } from "E:/adcode-sourcecode/apps/desktop/src/main/aiWorkspaceContext.ts";
import { createFileChange } from "E:/adcode-sourcecode/packages/ai/src/workspaces.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [project, baseUrl, prompt] = process.argv.slice(2);
if (project === undefined || baseUrl === undefined || prompt === undefined) throw new Error("usage: adcode.mjs <projectDir> <baseUrl> <prompt>");
const tools = [...BUILT_IN_TOOLS, ...ASSISTANT_EXTENSION_TOOLS, ...adcodeAppToolsFor({ browser: true, rooms: true }), BUILTIN_SKILL_TOOL, ...CHAT_FORK_TOOLS, DELEGATE_TASK, CREATE_AGENT, modToolDefinition()];
const workspace = { taskId: "", sandboxRoot: project, humanRoot: project };
const runner = createAiToolRunner({
  workspace: async () => workspace,
  directWrites: true,
  memory: () => null,
  // The desktop app writes straight into the project when edits apply automatically (the
  // default); this is that branch, without the undo journal the window keeps.
  writeSandboxFile: async (path: string, contents: string) => {
    const absolute = join(project, path);
    let original: string | null = null;
    try { original = await readFile(absolute, "utf8"); } catch { original = null; }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
    return createFileChange(path, original, contents);
  },
  onProposedEdit: () => undefined,
} as never);
const context = (): string => [
  aiWorkspaceContext(project, null, null, "direct"),
  "Live preview: not running. open_preview or view_page starts it.",
  builtinSkillGuidance(true),
  AUTO_FORK_GUIDANCE,
].join("\n");

const provider = createOpenAiCompatibleProvider({ id: "custom", displayName: "Bench", baseUrl, apiKey: "bench-key", models: ["bench-model"], sizeField: "max_tokens" } as never);
// Experiment: the conversation's own context before the shared instructions (BENCH_CONTEXT_FIRST=1).
const contextFirst = process.env["BENCH_CONTEXT_FIRST"] === "1";
const agent = createAgent({ provider, model: "bench-model", tools, runner, deferredTools: DEFERRED_TOOL_NAMES, ...(contextFirst ? { system: `${context()}

${DEFAULT_SYSTEM}` } : { context }) } as never);
const started = Date.now();
let text = "";
for await (const event of agent.send(prompt) as AsyncIterable<{ kind: string; text?: string; detail?: string; call?: { name: string } }>) {
  if (event.kind === "text") text += event.text ?? "";
  if (event.kind === "tool-call") console.log(`tool: ${event.call?.name ?? "?"}`);
  if (event.kind === "error") console.log("error:", event.detail);
}
console.log(text.trim());
console.log(`elapsed ${String(Date.now() - started)}`);
