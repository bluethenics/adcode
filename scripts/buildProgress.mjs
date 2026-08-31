/**
 * Turning electron-vite's build output into one progress bar.
 *
 * The raw output is three separate Vite runs printing their own headers, a scrolling
 * `transforming (1471) ..\..\..\..\node_modules\monaco-editor\esm\vs\...` line that wraps
 * twice in most terminals, two externalisation warnings nobody can act on, and a bundle
 * table - about forty lines to say "wait ninety seconds". Somebody running `npm start` for
 * the first time wants to know one thing: how much longer.
 *
 * **Progress is driven by time, corrected by milestones.** The obvious source - Vite's own
 * `transforming (N)` counter - is not available: piped, Vite prints a bare `transforming...`
 * with no number at all, because the counter is a TTY rewrite rather than a line. So the
 * bar is driven by how long each phase took last time, written to `.adcode-cache` after
 * every successful build, and snapped to the truth whenever a real milestone arrives. The
 * first build on a machine uses the fallbacks below and is the only one that can be wrong.
 *
 * The counter is still parsed where it appears, because it costs three lines to keep and a
 * future Vite may start emitting it.
 *
 * Everything here is pure and clock-injectable so it can be tested without spawning a
 * ninety-second build; `start.mjs` owns the spawning, the redraw timer and the terminal.
 */

/**
 * The three environments electron-vite builds, in the order it builds them, with what to
 * assume about a machine that has never built before. The numbers are the shape of the
 * work rather than a measurement: main and preload are small, and the renderer - Monaco,
 * xterm, tree-sitter - is most of the wait.
 */
export const PHASES = [
  { id: "main", label: "the main process", fallbackMs: 11_000 },
  { id: "preload", label: "the preload bridge", fallbackMs: 900 },
  { id: "renderer", label: "the workbench", fallbackMs: 78_000 },
];

/** Never let a phase claim to be finished before its milestone says so. */
const PHASE_CEILING = 0.97;

/**
 * What to say while it works.
 *
 * Dry rather than zany, and true rather than either: every one of these names something
 * the build is genuinely doing. The last two are the only ones that matter - somebody
 * ninety seconds into a wait wants to be told this happens once, not to be amused.
 */
export const QUIPS = [
  "Folding a few thousand modules into three files.",
  "Teaching Monaco the difference between a string and a promise.",
  "Handing the terminal its own copy of the alphabet.",
  "Asking tree-sitter to parse the parsers.",
  "Explaining to Chromium that this one is an editor.",
  "Deciding which sponsored cards you will not be shown while debugging.",
  "Putting the workbench together in the order it will be taken apart.",
  "Persuading the bundler that 2,000 modules is not a lot.",
  "Still going. The first build is the slow one.",
  "This happens once. Every launch after it opens straight away.",
];

/** How long each quip holds the line before the next one takes over. */
export const QUIP_MS = 6_000;

export function quipAt(elapsedMs) {
  const index = Math.floor(Math.max(0, elapsedMs) / QUIP_MS);
  // The last two are the reassuring ones, so a long build settles on them rather than
  // looping back to jokes somebody has already read twice.
  return index >= QUIPS.length ? QUIPS[QUIPS.length - 1] : QUIPS[index];
}

/**
 * Vite colours its output whether or not anybody is watching.
 *
 * picocolors decides on `process.stdout.isTTY` of the Vite process, and electron-vite
 * spawns Vite with its own inherited stdio, so piping this script's child does not reach
 * the decision - every line arrives wrapped in escapes. Anchored patterns then match
 * nothing, because the line does not start with `out/`, it starts with `\u001b[2m`. That
 * cost a whole build to find, so stripping happens once, at the door.
 */
const ANSI = /\u001b\[[0-9;?]*[a-zA-Z]/g;

function stripAnsi(line) {
  return line.replace(ANSI, "");
}

const RE = {
  environment: /building (ssr|client) environment/,
  transforming: /transforming \((\d+)\)/,
  transformed: /([\d,]+) modules transformed/,
  /*
   * Only that a phase finished, never how long it took: Vite says "11.58s", "258ms" and -
   * once a phase passes a minute, which the renderer always does - "1m 24s". Parsing that
   * zoo to recover a number this module already has from its own clock would be three
   * formats to get wrong for no gain.
   */
  builtIn: /built in \d/,
  // `../../out/renderer/index.html` as well as `out/main/index.js`: the renderer's Vite
  // root is the renderer directory, so its table is written relative to that.
  output: /((?:\.\.[\\/])*out[\\/]\S+)\s+([\d,.]+)\s*kB/,
  warning: /^\[plugin |has been externalized/,
};

function toNumber(text) {
  return Number(text.replace(/,/g, ""));
}

/**
 * A build in progress.
 *
 * `push` takes one line of the child's output at a time; `snapshot` reports where things
 * stand right now, which depends on the clock as well as on what has been read. `learned`
 * is what should be written to the cache once the build succeeds.
 */
export function createBuildProgress(options = {}) {
  const durations = options.durations ?? {};
  /*
   * Last build's module counts, which turn a `transforming (N)` line into a fraction. Vite
   * only prints its own total when a phase finishes, so without these the counter has no
   * denominator until the moment it stops mattering.
   */
  const knownModules = options.modules ?? {};
  const now = options.now ?? (() => Date.now());

  const startedAt = now();
  let phase = 0;
  let phaseStartedAt = startedAt;
  let seenEnvironments = 0;

  let modules = 0;
  let moduleTotal = 0;
  let warnings = 0;
  let highWater = 0;
  let done = false;

  const outputs = [];
  const measured = {};
  const moduleCounts = {};

  function phaseDuration(index) {
    const known = durations[PHASES[index].id];
    return typeof known === "number" && known > 0 ? known : PHASES[index].fallbackMs;
  }

  function weights() {
    const each = PHASES.map((_, index) => phaseDuration(index));
    const total = each.reduce((sum, one) => sum + one, 0);
    return each.map((one) => one / total);
  }

  function beginPhase(index) {
    // Whatever the phase actually cost is worth more than the estimate that replaced it.
    if (index > 0 && index <= PHASES.length) {
      const previous = PHASES[index - 1];
      if (previous !== undefined && measured[previous.id] === undefined) {
        measured[previous.id] = now() - phaseStartedAt;
      }
    }

    phase = index;
    phaseStartedAt = now();
    modules = 0;
    moduleTotal = 0;
  }

  return {
    push(raw) {
      const line = stripAnsi(raw).trim();

      if (RE.warning.test(line)) {
        warnings += 1;
        return;
      }

      const environment = RE.environment.exec(line);
      if (environment !== null) {
        // The two ssr runs are main then preload, in that order; client is the renderer.
        // Counting them is steadier than matching on names Vite does not print here.
        beginPhase(environment[1] === "client" ? 2 : Math.min(seenEnvironments, 1));
        seenEnvironments += 1;
        return;
      }

      const transforming = RE.transforming.exec(line);
      if (transforming !== null) {
        modules = toNumber(transforming[1]);
        return;
      }

      const transformed = RE.transformed.exec(line);
      if (transformed !== null) {
        moduleTotal = toNumber(transformed[1]);
        modules = moduleTotal;
        const counted = PHASES[phase];
        if (counted !== undefined) moduleCounts[counted.id] = moduleTotal;
        return;
      }

      const output = RE.output.exec(line);
      if (output !== null) {
        outputs.push({ path: output[1].replace(/\\/g, "/"), kB: toNumber(output[2]) });
        return;
      }

      if (RE.builtIn.test(line)) {
        const finished = PHASES[phase];
        if (finished !== undefined) measured[finished.id] = now() - phaseStartedAt;
        // The last phase's "built in" is the end of the whole build.
        if (phase >= PHASES.length - 1) done = true;
      }
    },

    snapshot() {
      const elapsedMs = now() - startedAt;
      const share = weights();

      let fraction = 0;
      for (let index = 0; index < phase; index += 1) fraction += share[index];

      if (done) {
        fraction = 1;
      } else if (phase < PHASES.length) {
        /*
         * Modules are the better signal when there are any to count - a real count against
         * a real denominator beats an estimate. Both parts have to be there, though: a
         * denominator with no counter would freeze the bar at the start of the phase for
         * exactly as long as Vite declines to print `transforming` lines into a pipe.
         */
        const total = moduleTotal > 0 ? moduleTotal : (knownModules[PHASES[phase].id] ?? 0);
        const within =
          total > 0 && modules > 0
            ? modules / total
            : (now() - phaseStartedAt) / phaseDuration(phase);
        fraction += share[phase] * Math.min(PHASE_CEILING, Math.max(0, within));
      }

      // A learned duration that turns out to be too short would otherwise make the bar
      // travel backwards when the next phase begins, which reads as a fault.
      highWater = Math.max(highWater, Math.min(1, fraction));

      const current = PHASES[Math.min(phase, PHASES.length - 1)];
      return {
        fraction: highWater,
        phaseId: current.id,
        label: current.label,
        modules,
        moduleTotal,
        outputs: [...outputs],
        warnings,
        done,
        elapsedMs,
      };
    },

    learned() {
      return { durations: { ...measured }, modules: { ...moduleCounts }, total: now() - startedAt };
    },
  };
}

/* ── Drawing ──────────────────────────────────────────────────────────── */

const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatSize(kB) {
  return kB >= 1000 ? `${(kB / 1000).toFixed(1)} MB` : `${Math.round(kB)} kB`;
}

/**
 * One frame, as an array of lines.
 *
 * Returned rather than written so the shape can be asserted in a test without a terminal,
 * and so `start.mjs` owns every escape code that moves the cursor.
 */
export function renderFrame(input) {
  const { fraction, label, quip, elapsedMs, columns = 80, colour = true } = input;
  const dim = colour ? DIM : "";
  const bold = colour ? BOLD : "";
  const off = colour ? RESET : "";

  const percent = `${String(Math.round(fraction * 100)).padStart(3, " ")}%`;
  const time = formatDuration(elapsedMs);

  // Everything that is not the bar: two spaces, the label, the caps, the percent and the
  // clock, plus the gaps between them. The bar takes whatever is left.
  const width = Math.max(10, Math.min(48, columns - 30));
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const bar = `${"█".repeat(filled)}${dim}${"░".repeat(width - filled)}${off}`;

  return [
    `  ${bold}Building ADCode${off}  ▐${bar}▌ ${percent}  ${dim}${time}${off}`,
    `  ${dim}${label}${off}`,
    `  ${dim}${quip}${off}`,
  ];
}

/**
 * The one line left behind once it works.
 *
 * The whole bundle rather than three entry files: `out/renderer/index.html` is a few
 * kilobytes of markup pointing at everything that matters, so naming it next to the main
 * process would put the smallest number where the largest belongs.
 */
export function renderSummary(state, colour = true) {
  const dim = colour ? DIM : "";
  const off = colour ? RESET : "";

  const written = state.outputs.reduce((sum, one) => sum + one.kB, 0);
  const files = state.outputs.length;
  const size =
    files > 0
      ? `  ${dim}${formatSize(written)} across ${files} ${files === 1 ? "file" : "files"}${off}`
      : "";

  return `  Built ADCode in ${formatDuration(state.elapsedMs)}${size}`;
}
