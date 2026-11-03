import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { NotificationHandle, NotificationSink } from "../../../../packages/ads/src/types.ts";
import { formatMicros } from "../../../../packages/ads/src/index.ts";
import type { AppContext } from "../context.ts";
import { createTerminalAdRuntime } from "../ads/runtime.ts";
import { printLines } from "../tui/components.ts";
import { cliPaths, desktopPaths } from "../util/paths.ts";
import { listSessions } from "../ai/sessions.ts";
import { relativeTime } from "../util/format.ts";

const NO_NOTICE: NotificationSink = {
  show: (): NotificationHandle => ({ update: () => undefined, dismiss: () => undefined }),
};

export async function runStatus(ctx: AppContext): Promise<number> {
  const ui = ctx.ui;
  const sessions = listSessions();
  const latest = sessions[0] ?? null;
  const provider = ctx.catalogue.providers.find((one) => one.id === ctx.selection.providerId);
  const writable = (() => {
    try {
      mkdirSync(cliPaths.cache(), { recursive: true });
      const probe = `${cliPaths.cache()}\\status.${process.pid}.tmp`;
      writeFileSync(probe, "ok");
      unlinkSync(probe);
      return true;
    } catch {
      return false;
    }
  })();

  const runtime = createTerminalAdRuntime({
    account: ctx.account,
    sink: NO_NOTICE,
    adsEnabled: false,
    preset: ctx.config.ads.preset,
    themeKind: ctx.adThemeKind(),
    env: ctx.env,
    settleMs: 0,
  });

  let balance: string | null = null;
  let balanceMicros: string | null = null;
  let balanceError: string | null = null;
  let pending = 0;
  let killSwitch = false;
  let caps = { minIntervalMs: 0, dailyCap: 0 };
  try {
    const [balanceResult, config, receipts] = await Promise.all([
      runtime.refreshBalance(),
      runtime.config(),
      runtime.pendingReceipts(),
    ]);
    pending = receipts;
    caps = runtime.effectiveCaps();
    if (balanceResult.ok) {
      balance = formatMicros(balanceResult.value.availableMicros);
      balanceMicros = balanceResult.value.availableMicros.toString();
    } else {
      balanceError = balanceResult.error.detail;
    }
    killSwitch = config.ok && config.value.killSwitch;
  } finally {
    await runtime.shutdown();
  }

  const uid = ctx.account.uid();
  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      command: "status",
      version: ctx.version,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        terminal: ctx.isTTY,
        color: ctx.color,
        unicode: ctx.unicode,
        motion: ctx.motion.enabled,
        theme: ctx.themeName,
        cwd: ctx.cwd,
        root: ctx.root,
      },
      account: {
        source: ctx.account.source,
        uid,
        signedIn: ctx.desktop.identityFound,
        desktopIdentity: ctx.desktop.identityFound,
        machine: ctx.desktop.dataDir,
        cliData: cliPaths.config().replace(/[\\/]config\.json$/, ""),
      },
      model: {
        provider: ctx.selection.providerId,
        providerName: ctx.selection.providerName,
        id: ctx.selection.modelId,
        name: ctx.selection.modelName,
        ready: ctx.selection.ready,
        reason: ctx.selection.reason,
        keySource: provider === undefined ? null : provider.keySource,
        included: ctx.selection.included,
        savedChoice: ctx.config.model,
      },
      catalogue: {
        source: ctx.catalogue.source,
        refreshedAt: ctx.catalogue.refreshedAt === null ? null : new Date(ctx.catalogue.refreshedAt).toISOString(),
        providers: ctx.catalogue.providers.length,
        readyProviders: ctx.catalogue.providers.filter((one) => one.ready).length,
        liveError: ctx.catalogue.liveError,
      },
      ads: {
        enabled: ctx.config.ads.enabled && !ctx.flags.noAds,
        preset: ctx.config.ads.preset,
        killSwitch,
        minimumIntervalMs: caps.minIntervalMs,
        dailyCap: caps.dailyCap,
        pendingReceipts: pending,
        balanceMicros,
        balance,
        error: balanceError,
        server: ctx.env["ADCODE_AD_SERVER"] ?? "https://adcode.bluethenics.com",
      },
      sessions: {
        count: sessions.length,
        latest: latest === null ? null : { id: latest.id, title: latest.title, updatedAt: new Date(latest.updatedAt).toISOString() },
        directory: cliPaths.sessions(),
      },
      desktop: {
        dataDir: ctx.desktop.dataDir,
        settingsFound: ctx.desktop.settingsFound,
        keys: ctx.desktop.keyIds.length,
        customConnections: ctx.desktop.connections.length,
        oneDriveTrap: ctx.desktop.oneDriveTrap,
      },
      writable,
    }, null, 2)}\n`);
    return 0;
  }

  const width = Math.max(20, Math.min(ui.width, 104));
  const lines: string[] = [
    "",
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("STATUS", "ink", { bold: true })}  ${ui.paint(`ADCode ${ctx.version}`, "faint")}`,
    `  ${ui.paint(ui.glyphs.horizontal.repeat(Math.max(2, width - 4)), "borderSoft")}`,
    "",
  ];

  lines.push(`  ${ui.paint("ACCOUNT", "faint")}`);
  lines.push(`  ${ui.labelValue("Identity", ctx.account.source, { width: 12 })}`);
  if (uid !== null) lines.push(`  ${ui.labelValue("UID", uid, { width: 12 })}`);
  lines.push(`  ${ui.labelValue("Desktop", ctx.desktop.identityFound ? "signed in" : "not signed in", { width: 12, valueTone: ctx.desktop.identityFound ? "ink" : "warning" })}`);
  lines.push(`  ${ui.labelValue("State", writable ? "CLI folder writable" : "CLI folder not writable", { width: 12, valueTone: writable ? "ink" : "danger" })}`);
  lines.push("");

  lines.push(`  ${ui.paint("MODEL", "faint")}`);
  lines.push(`  ${ui.labelValue("Selected", `${ctx.selection.modelName}`, { width: 12, bold: true })}`);
  lines.push(`  ${ui.labelValue("Provider", ctx.selection.providerName, { width: 12 })}`);
  lines.push(`  ${ui.labelValue("Ready", ctx.selection.ready ? "yes" : ctx.selection.reason ?? "no", { width: 12, valueTone: ctx.selection.ready ? "money" : "warning" })}`);
  if (provider !== undefined) lines.push(`  ${ui.labelValue("Key", provider.keySource, { width: 12 })}`);
  lines.push(`  ${ui.labelValue("Catalogue", `${ctx.catalogue.source} ${ui.glyphs.dot} ${ctx.catalogue.providers.filter((one) => one.ready).length} ready`, { width: 12, valueTone: "faint" })}`);
  lines.push("");

  const adsOn = ctx.config.ads.enabled && !ctx.flags.noAds;
  lines.push(`  ${ui.paint("ADS", "faint")}`);
  lines.push(`  ${ui.labelValue("State", adsOn ? (killSwitch ? "paused by the server" : "on") : "off", { width: 12, valueTone: adsOn ? "ink" : "faint" })}`);
  lines.push(`  ${ui.labelValue("Cadence", ctx.config.ads.preset, { width: 12 })}`);
  lines.push(`  ${ui.labelValue("Balance", balance ?? balanceError ?? "—", { width: 12, valueTone: balance === null ? "warning" : "money", bold: balance !== null })}`);
  if (pending > 0) lines.push(`  ${ui.labelValue("Pending", `${pending} receipts`, { width: 12, valueTone: "warning" })}`);
  lines.push("");

  lines.push(`  ${ui.paint("CONVERSATIONS", "faint")}`);
  lines.push(`  ${ui.labelValue("Saved", `${sessions.length}`, { width: 12 })}`);
  if (latest !== null) lines.push(`  ${ui.labelValue("Latest", `${latest.title} ${ui.glyphs.dot} ${relativeTime(latest.updatedAt)}`, { width: 12, valueTone: "muted" })}`);
  lines.push("");

  lines.push(`  ${ui.paint("RUNTIME", "faint")}`);
  lines.push(`  ${ui.labelValue("Node", `${process.version} ${ui.glyphs.dot} ${process.platform}/${process.arch}`, { width: 12, valueTone: "muted" })}`);
  lines.push(`  ${ui.labelValue("Theme", `${ctx.themeName}${ctx.motion.enabled ? " + motion" : ""}`, { width: 12, valueTone: "muted" })}`);
  lines.push(`  ${ui.labelValue("Workspace", ctx.cwd, { width: 12, valueTone: "muted" })}`);
  lines.push("");
  lines.push(`  ${ui.paint("Config", "faint")}     ${ui.paint(cliPaths.config(), "muted")}`);
  lines.push(`  ${ui.paint("Sessions", "faint")}   ${ui.paint(cliPaths.sessions(), "muted")}`);
  lines.push(`  ${ui.paint("Desk data", "faint")}  ${ui.paint(desktopPaths.settings().replace(/[\\/]settings\.json$/, ""), "muted")}`);
  lines.push("");
  printLines(lines, ctx.stdout);
  return 0;
}
