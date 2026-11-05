/**
 * Plugins made by ADCode: ready to install on day one, offline, and the best way to see
 * what a plugin can be before writing one. Each is an ordinary manifest - open one in the
 * Studio and it is a template.
 */
import { PLUGIN_FORMAT } from "./plugin.ts";

const plugin = (manifest: Record<string, unknown>): Record<string, unknown> => ({ format: PLUGIN_FORMAT, version: "1.0.0", icon: "", tags: [], ...manifest });

/* ── Add-ons ─────────────────────────────────────────────────────────────── */

const USAGE_METER = plugin({
  id: "usage-meter",
  name: "Usage meter",
  version: "1.1.0",
  description: "Shows how much of your AI allowance you have used, as a percentage above the chat box, so a long task never runs out by surprise.",
  category: "add-ons",
  tags: ["usage", "chat"],
  readme: "A thin bar above the message box: the share of your AI allowance used, what is left and when it refills. Choose in its settings whether it follows this session, this week, or how full the conversation is. Click Details for the full breakdown.",
  options: [
    { id: "show", label: "What the bar shows", type: "choice", default: "session", help: "The session and weekly windows come from your plan; the conversation is how much of the model's memory this chat uses.", choices: [{ value: "session", label: "This session's allowance" }, { value: "weekly", label: "This week's allowance" }, { value: "context", label: "How full the conversation is" }] },
    { id: "warnAt", label: "Turn amber at (%)", type: "number", default: 80, min: 50, max: 99, step: 1, help: "The bar changes colour once usage passes this share." },
  ],
  contributes: {
    addons: [{
      id: "meter",
      title: "Usage meter",
      slot: "chat",
      data: ["usage", "context", "model"],
      commands: ["ai.showUsage"],
      html: `<style>
.row { display: flex; align-items: center; gap: 10px; padding: 4px 2px; }
.label { color: var(--text-secondary); white-space: nowrap; }
.bar { flex: 1; height: 4px; border-radius: 4px; background: var(--bg-active); overflow: hidden; }
.fill { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left; transform: scaleX(0); transition: transform 320ms cubic-bezier(0.23, 1, 0.32, 1), background-color 200ms ease; }
.fill[data-tone="warn"] { background: var(--warning); }
.fill[data-tone="full"] { background: var(--danger); }
.value { margin-left: auto; color: var(--text-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar + .value { margin-left: 0; }
.percent { color: var(--text-primary); font-weight: 600; }
button { padding: 0 6px; border-color: transparent; background: transparent; color: var(--text-tertiary); }
</style>
<div class="row"><span class="label" id="label">AI usage</span><span class="bar" id="bar"><span class="fill" id="fill"></span></span><span class="value" id="value">…</span><button id="details" type="button">Details</button></div>
<script>
const fill = document.getElementById("fill"), value = document.getElementById("value"), label = document.getElementById("label"), bar = document.getElementById("bar");
document.getElementById("details").onclick = () => adcode.run("ai.showUsage");
function show(percent, words) {
  bar.style.display = percent === null ? "none" : "";
  if (percent !== null) {
    fill.style.transform = "scaleX(" + Math.max(0.02, Math.min(1, percent / 100)) + ")";
    fill.dataset.tone = percent >= 100 ? "full" : percent >= (adcode.options.warnAt || 80) ? "warn" : "ok";
  }
  value.innerHTML = "";
  if (percent !== null) { const strong = document.createElement("span"); strong.className = "percent"; strong.textContent = percent + "%"; value.append(strong, " "); }
  value.append(words);
}
function paint() {
  const { usage, context } = adcode.data;
  const mode = adcode.options.show || "session";
  if (mode === "context") {
    label.textContent = "Conversation";
    show(context ? context.percent : null, context ? "of the model's memory · compacts at " + context.compactsAt + "%" : "No conversation yet");
    return;
  }
  if (!usage) return;
  label.textContent = usage.plan ? usage.plan + " plan" : usage.label;
  const window = mode === "weekly" ? usage.weekly : usage;
  if (!window || window.percent === null || window.percent === undefined) { show(null, usage.requestsToday + (usage.requestsToday === 1 ? " request" : " requests") + " today"); return; }
  show(window.percent, (mode === "weekly" ? "used this week" : "used") + (window.resetsIn ? " · refills in " + window.resetsIn : ""));
}
adcode.on("data", paint);
adcode.on("options", paint);
</script>`,
    }],
  },
});

const GIT_GLANCE = plugin({
  id: "git-glance",
  name: "Git at a glance",
  description: "Your branch and how many files changed, in the sidebar, with one click to review them or draft a commit message.",
  category: "add-ons",
  tags: ["git", "sidebar"],
  readme: "Shows the current branch, how many files are changed, and whether you are ahead or behind. Review opens Changes; Commit message asks the assistant for one in the message box.",
  contributes: {
    addons: [{
      id: "status",
      title: "Git at a glance",
      slot: "sidebar",
      data: ["git", "project"],
      commands: ["workspace.changes"],
      prompt: true,
      html: `<style>
.card { display: grid; gap: 6px; margin: 0 4px; padding: 8px 10px; border: 1px solid var(--border-hairline); border-radius: 8px; }
.top { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.branch { font: 500 12px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.actions { display: flex; gap: 6px; }
.actions button { flex: 1; }
.none { color: var(--text-tertiary); }
</style>
<div class="card" id="card"><span class="none">Open a Git project to see its branch</span></div>
<script>
const card = document.getElementById("card");
adcode.on("data", ({ git }) => {
  if (!git || !git.isRepo) { card.innerHTML = '<span class="none">Open a Git project to see its branch</span>'; return; }
  const sync = [git.ahead ? git.ahead + " ahead" : "", git.behind ? git.behind + " behind" : ""].filter(Boolean).join(" · ");
  card.innerHTML = '<div class="top"><span class="branch"></span></div><span class="meta"></span><div class="actions"><button id="review" type="button">Review</button><button id="commit" type="button">Commit message</button></div>';
  card.querySelector(".branch").textContent = git.branch || "detached";
  card.querySelector(".meta").textContent = (git.changed === 0 ? "No changes" : git.changed + (git.changed === 1 ? " file changed" : " files changed")) + (sync ? " · " + sync : "");
  document.getElementById("review").onclick = () => adcode.run("workspace.changes");
  document.getElementById("commit").onclick = () => adcode.prompt("/commit");
  document.getElementById("review").disabled = git.changed === 0;
  document.getElementById("commit").disabled = git.changed === 0;
});
</script>`,
    }],
  },
});

const FOCUS_TIMER = plugin({
  id: "focus-timer",
  name: "Focus timer",
  version: "1.1.0",
  description: "A focus timer in the status bar, with a short break after each round. Set the lengths you like; it keeps counting while you switch projects.",
  category: "add-ons",
  tags: ["focus", "statusbar"],
  readme: "Click the timer to start or pause. After a focus round it offers a break. Rounds finished today are counted beside it. Change the lengths in its settings on the Installed tab.",
  options: [
    { id: "focusMinutes", label: "Focus length (minutes)", type: "number", default: 25, min: 5, max: 90, step: 5, help: "" },
    { id: "breakMinutes", label: "Break length (minutes)", type: "number", default: 5, min: 1, max: 30, step: 1, help: "" },
    { id: "showRounds", label: "Count rounds finished today", type: "toggle", default: true, help: "" },
  ],
  contributes: {
    addons: [{
      id: "timer",
      title: "Focus timer",
      slot: "statusbar",
      data: [],
      commands: [],
      html: `<style>
button { border: 0; background: transparent; padding: 0 6px; height: 22px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
button[data-running="true"] { color: var(--accent); }
.done { color: var(--text-tertiary); }
</style>
<button id="timer" type="button" title="Start a focus round">Focus 25:00</button><span class="done" id="done"></span>
<script>
const minutes = (key, fallback) => Number(adcode.options[key]) || fallback;
const button = document.getElementById("timer"), done = document.getElementById("done");
let state = { mode: "focus", left: null, endsAt: null, rounds: 0, day: "" };
const length = () => (state.mode === "focus" ? minutes("focusMinutes", 25) : minutes("breakMinutes", 5)) * 60;
const save = () => adcode.store.set("state", state);
const left = () => state.endsAt ? Math.max(0, Math.round((state.endsAt - Date.now()) / 1000)) : (state.left === null ? length() : state.left);
function paint() {
  if (state.endsAt && left() === 0) {
    if (state.mode === "focus") { state.rounds++; state.mode = "rest"; } else { state.mode = "focus"; }
    state.left = null; state.endsAt = null; save();
  }
  const s = left();
  button.textContent = (state.mode === "focus" ? "Focus " : "Break ") + String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  button.dataset.running = String(Boolean(state.endsAt));
  button.title = state.endsAt ? "Pause" : state.mode === "focus" ? "Start a focus round" : "Start a break";
  done.textContent = adcode.options.showRounds !== false && state.rounds ? " · " + state.rounds + " today" : "";
}
button.onclick = () => {
  if (state.endsAt) { state.left = left(); state.endsAt = null; } else { state.endsAt = Date.now() + left() * 1000; }
  save(); paint();
};
adcode.on("init", () => {
  state = Object.assign(state, adcode.store.get("state") || {});
  const today = new Date().toDateString();
  if (state.day !== today) { state.rounds = 0; state.day = today; }
  paint();
  setInterval(paint, 1000);
});
adcode.on("options", () => { if (!state.endsAt) state.left = null; paint(); });
paint();
</script>`,
    }],
  },
});

const QUICK_PROMPTS = plugin({
  id: "quick-prompts",
  name: "Quick prompts",
  description: "One-click starters above the chat box: fix errors, write tests, explain the open file, make it work on phones.",
  category: "add-ons",
  tags: ["chat", "prompts"],
  readme: "Each button puts a well-written request in the message box. Change it if you like, then press Send. Nothing is sent without you.",
  contributes: {
    addons: [{
      id: "starters",
      title: "Quick prompts",
      slot: "chat",
      data: ["editor"],
      commands: [],
      prompt: true,
      html: `<style>
.row { display: flex; gap: 6px; padding: 4px 2px; overflow-x: auto; scrollbar-width: none; }
button { white-space: nowrap; border-radius: 999px; padding: 2px 10px; color: var(--text-secondary); }
button:hover { color: var(--text-primary); }
</style>
<div class="row" id="row"></div>
<script>
const file = () => (adcode.data.editor && adcode.data.editor.file) || "the open file";
const prompts = [
  ["Fix the errors", () => "Find and fix the errors in " + file() + ". Run the typecheck or tests afterwards to prove they are gone."],
  ["Write tests", () => "Write focused tests for " + file() + " with the project's existing test setup, run them, and fix any failures."],
  ["Explain this file", () => "Explain what " + file() + " does, step by step and in plain words, pointing at the important lines."],
  ["Make it work on phones", () => "Make the page work well at phone width (390px): no sideways scrolling, readable text, tappable buttons. Check it in the preview."],
  ["Tidy up", () => "Refactor " + file() + " for readability without changing what it does, then run the tests."],
];
const row = document.getElementById("row");
for (const [label, text] of prompts) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = label;
  button.onclick = () => adcode.prompt(text());
  row.append(button);
}
</script>`,
    }],
  },
});

const PROBLEM_COUNT = plugin({
  id: "problem-count",
  name: "Problems at a glance",
  description: "Errors and warnings in the open file, counted in the status bar. Click to open the Problems list.",
  category: "add-ons",
  tags: ["errors", "statusbar"],
  readme: "Red when the open file has errors, amber for warnings only, quiet when it is clean.",
  contributes: {
    addons: [{
      id: "count",
      title: "Problems at a glance",
      slot: "statusbar",
      data: ["problems", "editor"],
      commands: ["view.problems"],
      html: `<style>
button { border: 0; background: transparent; padding: 0 6px; height: 22px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
button[data-tone="error"] { color: var(--danger); }
button[data-tone="warn"] { color: var(--warning); }
</style>
<button id="count" type="button" title="Open Problems">No problems</button>
<script>
const button = document.getElementById("count");
button.onclick = () => adcode.run("view.problems");
adcode.on("data", ({ problems, editor }) => {
  if (!problems || !editor || !editor.file) { button.textContent = "No file open"; button.dataset.tone = ""; return; }
  const { errors, warnings } = problems;
  button.dataset.tone = errors ? "error" : warnings ? "warn" : "";
  button.textContent = errors || warnings ? [errors ? errors + (errors === 1 ? " error" : " errors") : "", warnings ? warnings + (warnings === 1 ? " warning" : " warnings") : ""].filter(Boolean).join(", ") : "No problems";
});
</script>`,
    }],
  },
});

const EARNINGS_TICKER = plugin({
  id: "earnings-ticker",
  name: "Earnings ticker",
  description: "Your ad earnings balance in the status bar, updated as it changes. Click for the full ledger.",
  category: "add-ons",
  tags: ["earnings", "statusbar"],
  readme: "Shows the same balance as the Earnings page, nothing more. Click it to see every row.",
  contributes: {
    addons: [{
      id: "balance",
      title: "Earnings ticker",
      slot: "statusbar",
      data: ["earnings"],
      commands: ["view.earnings"],
      html: `<style>
button { border: 0; background: transparent; padding: 0 6px; height: 22px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
button strong { color: var(--success); font-weight: 500; }
</style>
<button id="earned" type="button" title="Open Earnings">Earned <strong>…</strong></button>
<script>
const button = document.getElementById("earned");
button.onclick = () => adcode.run("view.earnings");
adcode.on("data", ({ earnings }) => { button.querySelector("strong").textContent = (earnings && earnings.balance) || "$0.00"; });
</script>`,
    }],
  },
});

/* ── Prompts and skills ──────────────────────────────────────────────────── */

const STRICT_REVIEW = plugin({
  id: "strict-review",
  name: "Strict reviewer",
  version: "1.1.0",
  description: "Makes /review read your changes like a senior engineer: correctness first, then security, tests and naming, with exact file and line.",
  category: "workflow",
  tags: ["review", "quality"],
  readme: "Replaces the instruction behind the built-in /review and adds a review checklist skill the assistant uses whenever it reviews code. Choose what it concentrates on in its settings. Uninstall to get the original /review back.",
  options: [
    { id: "focus", label: "Concentrate on", type: "choice", default: "everything", help: "What the review looks at first.", choices: [{ value: "everything", label: "Everything, most serious first" }, { value: "security", label: "Security above all" }, { value: "tests", label: "Missing and weak tests" }] },
  ],
  contributes: {
    slashCommands: [{
      id: "review",
      hint: "Strict review of my uncommitted changes",
      kind: "diff",
      overrides: true,
      prompt: "Review the attached uncommitted changes as a strict senior engineer, concentrating on: {{focus}}. Order findings by severity: bugs and wrong behaviour, security (injection, secrets, auth, unsafe input), data loss, missing or weak tests, then naming and readability. For each finding give the file and line, what goes wrong in a concrete case, and the fix. Do not praise, do not list style nits a formatter would fix, and say plainly if you find nothing serious. Do not change files.",
    }],
    skills: [{
      name: "review-checklist",
      description: "Use when reviewing code or a diff: a checklist of what senior reviewers look for, most serious first.",
      body: "# Review checklist\n\n1. **Does it do what it claims?** Trace one real input through the change. Look for off-by-one, wrong conditions, unhandled null or empty values, and async code that is not awaited.\n2. **Can it break something else?** Changed function signatures, shared state, migrations, and anything that runs on startup.\n3. **Security.** User input reaching a query, shell, path or HTML; secrets in code or logs; checks done only on the client.\n4. **Failure paths.** What happens when the network, disk or parsing fails - is the error shown, retried, or swallowed?\n5. **Tests.** Is the new behaviour tested, including the edge case that motivated it?\n6. **Readability.** Names that say what things are, no dead code, comments that explain why.\n\nReport findings most serious first, each with file, line, a concrete failing case and the fix.",
    }],
  },
});

const EXPLAIN_SIMPLY = plugin({
  id: "explain-simply",
  name: "Explain simply",
  description: "Plain-English explanations for people learning to code: an Explain simply command for selected code, and /eli5 in the chat.",
  category: "learning",
  tags: ["learning", "beginner"],
  readme: "Select some code and run \"Explain simply: Explain the selection\" from the command palette (Ctrl+Shift+P), or type /eli5 and a question in the chat. Answers use one everyday comparison and no jargon.",
  contributes: {
    actions: [{
      id: "selection",
      title: "Explain the selection",
      uses: "selection",
      prompt: "Explain the selected code to someone who started programming last month. Say what it does in one sentence first, then walk through it line by line in plain words, using one everyday comparison. Define any technical word the first time you use it. Keep it under 200 words and do not change any files.",
    }],
    slashCommands: [{
      id: "eli5",
      hint: "Explain it like I am new to coding",
      kind: "prompt",
      overrides: false,
      prompt: "Explain this to someone new to programming, in plain words with one everyday comparison, defining any technical term the first time it appears. Under 200 words: ",
    }],
  },
});

/** In the order the Plugins page shows them. */
export const STARTER_PLUGINS: readonly Record<string, unknown>[] = [
  USAGE_METER, QUICK_PROMPTS, GIT_GLANCE, FOCUS_TIMER, PROBLEM_COUNT, EARNINGS_TICKER, STRICT_REVIEW, EXPLAIN_SIMPLY,
];
