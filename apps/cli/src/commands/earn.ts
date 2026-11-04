import type { NotificationHandle, NotificationSink } from "../../../../packages/ads/src/types.ts";
import { formatMicros } from "../../../../packages/ads/src/index.ts";
import type { AppContext } from "../context.ts";
import { createTerminalAdRuntime } from "../ads/runtime.ts";
import { errorPanel, printLines } from "../tui/components.ts";
import { formatDuration, formatMicros as formatDollars } from "../util/format.ts";

const NO_NOTICE: NotificationSink = {
  show: (): NotificationHandle => ({
    update: () => undefined,
    dismiss: () => undefined,
  }),
};

export async function runEarn(ctx: AppContext): Promise<number> {
  const ui = ctx.ui;
  const runtime = createTerminalAdRuntime({
    account: ctx.account,
    sink: NO_NOTICE,
    adsEnabled: false,
    preset: ctx.config.ads.preset,
    themeKind: ctx.adThemeKind(),
    env: ctx.env,
    settleMs: 0,
  });

  try {
    const [balance, config, pending] = await Promise.all([
      runtime.refreshBalance(),
      runtime.config(),
      runtime.pendingReceipts(),
    ]);
    const caps = runtime.effectiveCaps();
    const uid = ctx.account.uid();

    if (ctx.flags.json) {
      ctx.stdout.write(`${JSON.stringify({
        generatedAt: new Date().toISOString(),
        command: "earn",
        account: {
          uid,
          source: ctx.account.source,
          signedIn: ctx.desktop.identityFound,
        },
        balance: balance.ok
          ? {
              availableMicros: balance.value.availableMicros.toString(),
              lifetimeMicros: balance.value.lifetimeMicros.toString(),
              available: formatMicros(balance.value.availableMicros),
              lifetime: formatMicros(balance.value.lifetimeMicros),
            }
          : null,
        error: balance.ok ? null : { kind: balance.error.kind, detail: balance.error.detail, status: balance.error.status ?? null },
        config: config.ok
          ? {
              killSwitch: config.value.killSwitch,
              projections: Object.fromEntries(
                Object.entries(config.value.projections).map(([preset, micros]) => [preset, micros.toString()]),
              ),
            }
          : null,
        ads: {
          enabled: ctx.config.ads.enabled && !ctx.flags.noAds,
          preset: ctx.config.ads.preset,
          minIntervalMs: caps.minIntervalMs,
          dailyCap: caps.dailyCap,
          pendingReceipts: pending,
        },
        server: ctx.env["ADCODE_AD_SERVER"] ?? "https://adcode.bluethenics.com",
      }, null, 2)}\n`);
      return balance.ok ? 0 : 1;
    }

    const width = Math.max(20, Math.min(ui.width, 104));
    const lines: string[] = [
      "",
      `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("EARN", "ink", { bold: true })}  ${ui.paint("real sponsors, real balance", "faint")}`,
      `  ${ui.paint(ui.glyphs.horizontal.repeat(Math.max(2, width - 4)), "borderSoft")}`,
      "",
    ];

    if (balance.ok) {
      lines.push(`  ${ui.paint("AVAILABLE", "faint")}`);
      lines.push(`  ${ui.paint(formatMicros(balance.value.availableMicros), "money", { bold: true })}`);
      lines.push(`  ${ui.paint(`${formatMicros(balance.value.lifetimeMicros)} earned in total`, "faint")}`);
    } else {
      lines.push(...errorPanel(ui, {
        title: "The ad server did not answer",
        message: balance.error.detail,
        hint: "Chat is unaffected. Run adcode doctor to check the account and connection.",
        width,
      }));
    }
    lines.push("");

    const enabled = ctx.config.ads.enabled && !ctx.flags.noAds;
    const killSwitch = config.ok && config.value.killSwitch;
    lines.push(`  ${ui.paint("SPONSORS", "faint")}`);
    lines.push(`  ${ui.labelValue("State", enabled ? (killSwitch ? "paused by the server" : "on") : "off", { width: 12, valueTone: enabled && !killSwitch ? "ink" : "warning" })}`);
    lines.push(`  ${ui.labelValue("Cadence", ctx.config.ads.preset, { width: 12 })}`);
    lines.push(`  ${ui.labelValue("At most", `${caps.dailyCap} a day`, { width: 12 })}`);
    lines.push(`  ${ui.labelValue("At least", `${formatDuration(caps.minIntervalMs)} apart`, { width: 12 })}`);
    if (pending > 0) {
      lines.push(`  ${ui.labelValue("Waiting", `${pending} ${pending === 1 ? "receipt" : "receipts"} to settle`, { width: 12, valueTone: "warning" })}`);
    }
    lines.push("");

    if (config.ok) {
      lines.push(`  ${ui.paint("PROJECTION", "faint")}  ${ui.paint("what the server estimates each cadence earns", "faint")}`);
      const presets = ["light", "standard", "max"] as const;
      for (const preset of presets) {
        const micros = config.value.projections[preset];
        const selected = ctx.config.ads.preset === preset;
        const label = preset.padEnd(9);
        lines.push(
          `  ${selected ? ui.paint(ui.glyphs.selected, "money") : " "} ${ui.paint(label, selected ? "ink" : "muted", { bold: selected })} ${ui.paint(
            micros === undefined ? "—" : `${formatMicros(micros)} / hour`,
            selected ? "money" : "faint",
          )}`,
        );
      }
      lines.push("");
    }

    lines.push(`  ${ui.paint("ACCOUNT", "faint")}`);
    lines.push(`  ${ui.labelValue("Identity", ctx.account.source, { width: 12 })}`);
    if (uid !== null) lines.push(`  ${ui.labelValue("UID", `${uid.slice(0, 8)}…`, { width: 12 })}`);
    lines.push(`  ${ui.labelValue("Settles", "receipts flush on the next launch", { width: 12, valueTone: "faint" })}`);
    lines.push("");
    lines.push(`  ${ui.paint("Ads never take the keyboard. ctrl+o opens, ctrl+x dismisses.", "faint")}`);
    lines.push("");
    printLines(lines, ctx.stdout);
    return balance.ok ? 0 : 1;
  } finally {
    await runtime.shutdown();
  }
}
