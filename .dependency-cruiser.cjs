/**
 * Architectural boundaries, enforced in CI.
 *
 * The rule `ads-must-not-import-memory` is the single most important line in this
 * repository (brief §1). The ad side promises that nothing from the user's code ever
 * leaves the machine; the AI memory side is full of exactly that. The promise survives
 * only if the two can never touch. Per §11, this rule failing is a release blocker.
 */

/** The five modules brief §8 marks `pure`: no I/O, no clock reads, no UI imports. */
const PURE_MODULES =
  "^packages/ads/src/(scheduler|validation|tagger|ledger|sponsorsView)\\.ts$";

/**
 * What a pure module is allowed to reach: `types.ts`, or another pure module.
 * Purity is transitive across this set, so `sponsorsView` composing `ledger.formatMicros`
 * stays pure. Anything outside it - an I/O module, an adapter, an npm package - does not.
 */
const PURE_OR_TYPES =
  "^packages/ads/src/(types|scheduler|validation|tagger|ledger|sponsorsView)\\.ts$";

module.exports = {
  forbidden: [
    {
      name: "ads-must-not-import-memory",
      comment:
        "THE FIREWALL (§1). packages/ads may not import from packages/memory, and no " +
        "memory content may reach any /v1/* endpoint. Release blocker (§11).",
      severity: "error",
      from: { path: "^packages/ads" },
      to: { path: "^packages/memory" },
    },
    {
      name: "memory-must-not-import-ads",
      comment:
        "The firewall's other face. Memory must not reach into the ad client either, " +
        "or a future refactor could route memory content outward through ads' own client.",
      severity: "error",
      from: { path: "^packages/memory" },
      to: { path: "^packages/ads" },
    },
    {
      name: "mock-server-must-not-import-client",
      comment:
        "§10: 'The mock server must not import the client's types.' A mock that shares " +
        "the client's type definitions cannot catch a contract mismatch, which is the " +
        "main thing it exists to do.",
      severity: "error",
      from: { path: "^mock-server" },
      to: { path: "^packages/" },
    },
    {
      name: "pure-modules-import-only-pure",
      comment:
        "§8: the five pure modules are pure functions of their arguments. They may " +
        "import types.ts or each other, and nothing else in this repo - reaching an " +
        "I/O module or an adapter would make them untestable in milliseconds.",
      severity: "error",
      from: { path: PURE_MODULES },
      to: { path: "^(packages|mock-server|apps)/", pathNot: PURE_OR_TYPES },
    },
    {
      name: "pure-modules-no-node-builtins",
      comment:
        "§8: pure means no I/O and no clock reads. A pure module reaching for node:fs " +
        "or node:crypto fails CI rather than review.",
      severity: "error",
      from: { path: PURE_MODULES },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "ads-ships-zero-runtime-deps",
      comment:
        "The chosen dependency posture: packages/ads/src carries no runtime dependency. " +
        "Supply chain stays out of the module built to distrust the network.",
      severity: "error",
      from: { path: "^packages/ads/src" },
      to: { dependencyTypes: ["npm", "npm-optional", "npm-peer", "npm-bundled"] },
    },
    {
      name: "ads-is-plain-typescript",
      comment:
        "§2: packages/ads is plain TypeScript with no Electron, Monaco, or DOM imports. " +
        "That is what keeps its logic testable in milliseconds.",
      severity: "error",
      from: { path: "^packages/ads/src" },
      to: { path: "^(electron|monaco-editor|@xterm|xterm)" },
    },
    {
      name: "no-circular",
      comment: "Cycles make modules impossible to reason about or test in isolation.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "An unreachable module is either dead code or a missing wire-up.",
      severity: "warn",
      from: { orphan: true, pathNot: "\\.d\\.ts$|(^|/)index\\.ts$" },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(__fixtures__|node_modules)/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".json"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
