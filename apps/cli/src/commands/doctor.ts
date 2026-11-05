import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NotificationHandle, NotificationSink } from "../../../../packages/ads/src/types.ts";
import { formatMicros } from "../../../../packages/ads/src/index.ts";
import type { AppContext } from "../context.ts";
import { createTerminalAdRuntime } from "../ads/runtime.ts";
import { fetchTagflowConfig, probeOllama } from "../ai/catalogue.ts";
import { resolveProviderKey } from "../keychain.ts";
import { printLines } from "../tui/components.ts";
import { Spinner } from "../tui/motion.ts";
import { cliPaths, desktopPaths } from "../util/paths.ts";
import { listSessions } from "../ai/sessions.ts";
import { streamChat, describeChatError } from "../ai/chat.ts";

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface Check {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly hint: string | null;
}

const NO_NOTICE: NotificationSink = {
  show: (): NotificationHandle => ({ update: () => undefined, dismiss: () => undefined }),
};

function minimumNode(): boolean {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 24;
}

function writableDirectory(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    const probe = join(path, `probe.${process.pid}.tmp`);
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(ctx: AppContext): Promise<number> {
  const ui = ctx.ui;
  const checks: Check[] = [];
  const live = ctx.flags.live;
  const json = ctx.flags.json;
  const spinner = json || !ctx.isTTY ? null : new Spinner(ui, ctx.motion, { out: ctx.stdout });

  async function check(
    id: string,
    label: string,
    work: () => Promise<Omit<Check, "id" | "label">> | Omit<Check, "id" | "label">,
  ): Promise<void> {
    const active = spinner?.start(`${label}…`) ?? null;
    let result: Omit<Check, "id" | "label">;
    try {
      result = await work();
    } catch (error) {
      result = {
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Run adcode doctor again with --verbose, or check the connection.",
      };
    }
    const entry: Check = { id, label, ...result };
    checks.push(entry);
    if (active !== null) {
      if (entry.status === "pass") active.succeed(`${label}  ${ui.paint(entry.detail, "faint")}`);
      else if (entry.status === "warn") active.warn(`${label}  ${ui.paint(entry.detail, "faint")}`);
      else if (entry.status === "fail") active.fail(`${label}  ${ui.paint(entry.detail, "faint")}`);
      else active.stop();
    }
  }

  if (!json) {
    printLines(
      [
        "",
        `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("DOCTOR", "ink", { bold: true })}  ${ui.paint("a look at this machine, account and network", "faint")}`,
        `  ${ui.paint(ui.glyphs.horizontal.repeat(Math.max(2, Math.min(ui.width, 104) - 4)), "borderSoft")}`,
        "",
      ],
      ctx.stdout,
    );
  }

  await check("node", "Node runtime", () => {
    const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    return {
      status: major >= 24 ? "pass" : "fail",
      detail: `${process.version} on ${process.platform}/${process.arch}`,
      hint: major >= 24 ? null : "ADCode CLI runs TypeScript directly and needs Node 24 or newer.",
    };
  });

  await check("terminal", "Terminal", () => {
    if (ctx.isTTY) {
      return {
        status: "pass",
        detail: `${ctx.stdout.columns ?? "?"}x${ctx.stdout.rows ?? "?"}${ctx.color ? ", colour" : ", no colour"}`,
        hint: null,
      };
    }
    return {
      status: "warn",
      detail: "not a TTY; full-screen views are unavailable",
      hint: "Run adcode from a terminal window for the deck, chat and sponsored cards.",
    };
  });

  await check("data", "CLI data folder", () => {
    const ok = writableDirectory(cliPaths.cache()) && writableDirectory(cliPaths.sessions());
    return {
      status: ok ? "pass" : "fail",
      detail: cliPaths.config().replace(/[\\/]config\.json$/, ""),
      hint: ok ? null : "Set ADCODE_CLI_DATA_DIR to a folder this account can write.",
    };
  });

  await check("desktop", "Desktop profile", () => {
    if (!ctx.desktop.settingsFound) {
      return {
        status: "warn",
        detail: "no settings.json found",
        hint: "Open ADCode Desktop once so the terminal can reuse its account and keys.",
      };
    }
    if (ctx.desktop.oneDriveTrap) {
      return {
        status: "warn",
        detail: "the profile looks like a OneDrive mirror",
        hint: "A stale mirror can hold an old account. Sign in again in the desktop app if models or balance look wrong.",
      };
    }
    return {
      status: "pass",
      detail: `${ctx.desktop.keyIds.length} stored ${ctx.desktop.keyIds.length === 1 ? "key" : "keys"}, ${ctx.desktop.connections.length} custom ${ctx.desktop.connections.length === 1 ? "connection" : "connections"}`,
      hint: null,
    };
  });

  let token: string | null = null;
  await check("account", "Account token", async () => {
    try {
      token = await ctx.account.requireToken();
      const uid = ctx.account.uid();
      return {
        status: "pass",
        detail: `${ctx.account.source}${uid === null ? "" : ` ${ui.glyphs.dot} ${uid.slice(0, 8)}…`}`,
        hint: null,
      };
    } catch (error) {
      return {
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Open ADCode Desktop and sign in. The terminal reuses the same account.",
      };
    }
  });

  await check("included", "Included AI", async () => {
    if (token === null) {
      return { status: "skip", detail: "no account token", hint: null };
    }
    const config = await fetchTagflowConfig(token);
    if (config === null) {
      return {
        status: "warn",
        detail: "config endpoint did not answer",
        hint: "The rest of the terminal still works. Check the connection, then run adcode doctor again.",
      };
    }
    if (!config.available) {
      return { status: "warn", detail: "not offered to this account", hint: "Included AI is paused for this account right now." };
    }
    return {
      status: "pass",
      detail: `${config.models.length} models ${ui.glyphs.dot} default ${config.defaultModel || "—"}`,
      hint: config.requiresVerifiedAccount ? "Chat needs the account's email verified." : null,
    };
  });

  await check("model", "Selected model", async () => {
    if (!ctx.selection.ready) {
      return {
        status: "warn",
        detail: `${ctx.selection.providerName} ${ui.glyphs.dot} ${ctx.selection.reason ?? "not ready"}`,
        hint: "Run adcode models to choose another model, or set the missing key.",
      };
    }
    const provider = ctx.catalogue.providers.find((one) => one.id === ctx.selection.providerId);
    if (provider === undefined) {
      return { status: "fail", detail: "the provider vanished from the catalogue", hint: "Run adcode models refresh." };
    }
    if (provider.id === "tagflow" || provider.id === "ollama") {
      return {
        status: "pass",
        detail: `${ctx.selection.modelName} ${ui.glyphs.dot} ${provider.keySource}`,
        hint: null,
      };
    }
    const key = await resolveProviderKey(provider.id, {
      env: ctx.env,
      envNames: [...provider.env],
      allowDesktop: true,
    });
    if (key === null) {
      return {
        status: "warn",
        detail: `${ctx.selection.modelName} has no readable key`,
        hint: `Set ${provider.env[0] ?? "the provider key"} or save it in ADCode Desktop.`,
      };
    }
    return {
      status: "pass",
      detail: `${ctx.selection.modelName} ${ui.glyphs.dot} key from ${key.source}`,
      hint: null,
    };
  });

  if (live) {
    await check("roundtrip", "Live model round trip", async () => {
      const started = Date.now();
      try {
        const built = await ctx.buildSelection();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        timer.unref?.();
        const result = await streamChat({
          built,
          turns: [{ role: "user", text: "Reply with the single word: ok" }],
          signal: controller.signal,
          maxTokens: 32,
          effort: "auto",
        });
        clearTimeout(timer);
        return result.text.trim().length > 0
          ? { status: "pass", detail: `answered in ${Date.now() - started}ms`, hint: null }
          : { status: "warn", detail: "the provider returned an empty reply", hint: "Try again, or choose another model with adcode models." };
      } catch (error) {
        return {
          status: "fail",
          detail: describeChatError(error, ctx.selection),
          hint: "Run adcode models to switch providers, or check the account in ADCode Desktop.",
        };
      }
    });
  } else {
    checks.push({
      id: "roundtrip",
      label: "Live model round trip",
      status: "skip",
      detail: "not requested",
      hint: "Run adcode doctor --live to spend one tiny request proving the model answers.",
    });
  }

  await check("ads", "Sponsor service", async () => {
    if (!ctx.config.ads.enabled || ctx.flags.noAds) {
      return { status: "skip", detail: "sponsored cards are off", hint: "Turn them on in ADCode Desktop or in the CLI config when you want the card runtime to run." };
    }
    const runtime = createTerminalAdRuntime({
      account: ctx.account,
      sink: NO_NOTICE,
      adsEnabled: true,
      preset: ctx.config.ads.preset,
      themeKind: ctx.adThemeKind(),
      env: ctx.env,
      settleMs: 0,
    });
    try {
      const [config, balance] = await Promise.all([runtime.config(), runtime.refreshBalance()]);
      if (!config.ok) {
        return {
          status: "warn",
          detail: config.error.detail,
          hint: "Chat is unaffected. Cards simply stay hidden until the ad server answers.",
        };
      }
      if (config.value.killSwitch) {
        return { status: "warn", detail: "the server has paused sponsored cards", hint: null };
      }
      if (!balance.ok) {
        return {
          status: "warn",
          detail: `config ok, balance unavailable: ${balance.error.detail}`,
          hint: "The card path may still work; run adcode earn to retry the balance.",
        };
      }
      return {
        status: "pass",
        detail: `${formatMicros(balance.value.availableMicros)} available ${ui.glyphs.dot} cadence ${ctx.config.ads.preset}`,
        hint: null,
      };
    } finally {
      await runtime.shutdown();
    }
  });

  await check("ollama", "Local models", async () => {
    const ollama = await probeOllama();
    if (!ollama.running) return { status: "skip", detail: "Ollama is not running", hint: "Install or start Ollama if you want everything local." };
    if (ollama.models.length === 0) return { status: "warn", detail: "Ollama is running with no models", hint: "Run `ollama pull` for a model you want to use." };
    return { status: "pass", detail: `${ollama.models.length} ${ollama.models.length === 1 ? "model" : "models"} via Ollama`, hint: null };
  });

  await check("sessions", "Saved conversations", () => {
    const sessions = listSessions();
    return {
      status: "pass",
      detail: `${sessions.length} ${sessions.length === 1 ? "conversation" : "conversations"} ${ui.glyphs.dot} ${cliPaths.sessions()}`,
      hint: null,
    };
  });

  const failed = checks.filter((entry) => entry.status === "fail");
  const warned = checks.filter((entry) => entry.status === "warn");

  if (json) {
    ctx.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      command: "doctor",
      live,
      summary: {
        pass: checks.filter((entry) => entry.status === "pass").length,
        warn: warned.length,
        fail: failed.length,
        skip: checks.filter((entry) => entry.status === "skip").length,
      },
      checks,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        terminal: ctx.isTTY,
        dataDir: cliPaths.config().replace(/[\\/]config\.json$/, ""),
        desktopDir: desktopPaths.settings().replace(/[\\/]settings\.json$/, ""),
      },
    }, null, 2)}\n`);
    return failed.length > 0 ? 1 : 0;
  }

  const lines: string[] = [];
  lines.push(`  ${ui.paint("RESULT", "faint")}  ${ui.paint(
    `${checks.filter((entry) => entry.status === "pass").length} passed  ${ui.glyphs.dot}  ${warned.length} ${warned.length === 1 ? "warning" : "warnings"}  ${ui.glyphs.dot}  ${failed.length} failed`,
    failed.length > 0 ? "danger" : warned.length > 0 ? "warning" : "money",
    { bold: true },
  )}`);
  lines.push("");
  // The label column fits the longest label, so every detail starts in one straight line.
  const labelWidth = Math.min(28, Math.max(...checks.map((entry) => entry.label.length)) + 1);
  const detailIndent = " ".repeat(2 + 2 + labelWidth + 1);
  const detailRoom = Math.max(16, Math.min(ui.width, 112) - detailIndent.length - 2);
  for (const entry of checks) {
    const icon = entry.status === "pass"
      ? ui.statusIcon("pass")
      : entry.status === "warn"
        ? ui.statusIcon("warn")
        : entry.status === "fail"
          ? ui.statusIcon("fail")
          : ui.paint(ui.glyphs.circle, "faint");
    const details = ui.wrap(entry.detail, detailRoom);
    lines.push(`  ${icon} ${ui.paint(ui.truncate(entry.label, labelWidth).padEnd(labelWidth), "ink")} ${ui.paint(details[0] ?? "", "muted")}`);
    for (const line of details.slice(1)) lines.push(`${detailIndent}${ui.paint(line, "muted")}`);
    if (entry.hint !== null && (entry.status === "fail" || entry.status === "warn" || ctx.flags.verbose)) {
      for (const line of ui.wrap(entry.hint, detailRoom)) {
        lines.push(`${detailIndent}${ui.paint(line, "faint")}`);
      }
    }
  }
  lines.push("");
  if (failed.length === 0) {
    lines.push(`  ${ui.paint("Nothing here blocks chat. Warnings are worth a look, not a wall.", "faint")}`);
  } else {
    lines.push(`  ${ui.paint("Fix the failed checks above; the hints name the setting or command.", "faint")}`);
  }
  lines.push("");
  printLines(lines, ctx.stdout);
  return failed.length > 0 ? 1 : 0;
}
