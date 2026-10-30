"use client";

import Link from "@/components/IntentLink";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { parseIncludedAiView, type IncludedAiModel } from "@/lib/includedAi";
import { parseStatusView, type StatusView } from "@/lib/statusView";
import { Icon } from "@/components/Icon";
import { ArrowRight } from "lucide";

/**
 * The live model control in the public header.
 *
 * Two answers, one question. `/v1/ai/tagflow/config` is the only public list of models
 * that are enabled *and* have a provider key, so it decides what is offered. `/v1/status`
 * says how those models have behaved, but only models that have served traffic appear
 * there - using it alone would silently hide every new model. The header merges them by
 * model id and never invents a health verdict it was not given.
 *
 * The panel is a non-modal popover: opening it does not trap focus or stop the page, and
 * Escape closes it. It is intentionally honest when the API is down, because the failure
 * that motivated it was a screen claiming a model was unavailable when the server had
 * simply not answered.
 */

type Phase = "loading" | "ready" | "error" | "paused" | "empty";
type Health = "operational" | "degraded" | "outage" | "maintenance" | "quiet" | "unknown";

interface ModelRow extends IncludedAiModel {
  health: Health;
}

const HEALTH_NOTE: Partial<Record<Health, string>> = {
  degraded: "Degraded",
  outage: "Down",
  maintenance: "Maintenance",
};

const STATE_LABEL: Record<string, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  unknown: "Health unknown",
  loading: "Checking",
  error: "Unavailable",
  paused: "Paused",
  empty: "None listed",
};

const HEALTH_LABEL: Record<Health, string> = {
  operational: "operational",
  degraded: "degraded",
  outage: "unavailable",
  maintenance: "in maintenance",
  quiet: "no recent traffic",
  unknown: "health unknown",
};

/** 200000 becomes 200K, 262144 becomes 256K, 1048576 becomes 1M. */
function formatContext(tokens: number): string {
  if (tokens >= 1_048_576 && tokens % 1_048_576 === 0) return `${String(tokens / 1_048_576)}M`;
  if (tokens % 1024 === 0) return `${String(tokens / 1024)}K`;
  if (tokens >= 1_000_000) return `${String(Number((tokens / 1_000_000).toFixed(1)))}M`;
  return `${String(Math.round(tokens / 1000))}K`;
}

function formatRate(rate: number): string {
  return `${String(Number.isInteger(rate) ? rate : Number(rate.toFixed(2)))}×`;
}

function utcTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  return (await response.json()) as unknown;
}

export function HeaderStatus() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ReturnType<typeof parseIncludedAiView>>(null);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [configFailed, setConfigFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async (first: boolean): Promise<void> => {
      if (first) setLoading(true);
      const [configAnswer, statusAnswer] = await Promise.allSettled([
        readJson("/v1/ai/tagflow/config", controller.signal).then(parseIncludedAiView),
        readJson("/v1/status?days=7", controller.signal).then(parseStatusView),
      ]);
      if (!active) return;

      if (configAnswer.status === "fulfilled" && configAnswer.value !== null) {
        setConfig(configAnswer.value);
        setConfigFailed(false);
        setCheckedAt(Date.now());
      } else {
        setConfigFailed(true);
      }
      setStatus(statusAnswer.status === "fulfilled" ? statusAnswer.value : null);
      setLoading(false);
    };

    void load(true);
    const timer = window.setInterval(() => void load(false), 60_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [attempt]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const models = config?.models ?? [];

  /*
   * One model id can arrive through more than one provider, and the status feed reports
   * each separately. The header lists the model once, so it keeps the worst answer:
   * an outage through one provider is not hidden by a healthy route through another.
   */
  const severity: Record<Health, number> = {
    outage: 5,
    degraded: 4,
    maintenance: 3,
    operational: 2,
    quiet: 1,
    unknown: 0,
  };
  const healthByModel = new Map<string, Health>();
  for (const model of status?.models ?? []) {
    const health: Health =
      model.state === "operational" ||
      model.state === "degraded" ||
      model.state === "outage" ||
      model.state === "maintenance" ||
      model.state === "quiet"
        ? model.state
        : "unknown";
    const seen = healthByModel.get(model.model);
    if (seen === undefined || severity[health] > severity[seen]) healthByModel.set(model.model, health);
  }

  const rows: ModelRow[] = models.map((model) => ({
    ...model,
    health: healthByModel.get(model.id) ?? "unknown",
  }));

  const phase: Phase =
    config === null
      ? loading
        ? "loading"
        : "error"
      : !config.available
        ? "paused"
        : config.models.length === 0
          ? "empty"
          : "ready";

  const healthKnown = status !== null;
  const downCount = rows.filter((row) => row.health === "outage").length;
  const anyDegraded =
    status?.overall.state === "degraded" ||
    status?.overall.state === "maintenance" ||
    rows.some((row) => row.health === "degraded" || row.health === "maintenance");
  const anyOutage = status?.overall.state === "outage" || downCount > 0;
  const state: Health = !healthKnown
    ? "unknown"
    : anyOutage
      ? "outage"
      : anyDegraded
        ? "degraded"
        : "operational";

  const count = rows.length;
  const triggerLabel =
    phase === "loading"
      ? "Checking models"
      : phase === "error"
        ? "AI status unavailable"
        : phase === "paused"
          ? "Models paused"
          : phase === "empty"
            ? "No models available"
            : state === "outage"
              ? `${String(Math.max(0, count - downCount))} of ${String(count)} models live`
              : state === "unknown"
                ? `${String(count)} models available`
                : `${String(count)} models live`;

  const title =
    phase === "loading"
      ? "Checking models"
      : phase === "error"
        ? "Status unavailable"
        : phase === "paused"
          ? "Included AI is paused"
          : phase === "empty"
            ? "No models available"
            : `${String(count)} models available`;

  const subtitle =
    phase === "loading"
      ? "Reading the model directory and live health."
      : phase === "error"
        ? "The model directory didn't answer. This is usually temporary."
        : phase === "paused"
          ? "An administrator has turned included AI off for now."
          : phase === "empty"
            ? "The directory is enabled but lists no connected model."
            : configFailed
              ? "Showing the last known list; the latest refresh failed."
              : healthKnown
                ? "Live health, measured from real requests."
                : "Models are available. Health data didn't answer.";

  const chipState =
    phase === "ready"
      ? state
      : phase === "loading"
        ? "loading"
        : phase === "error"
          ? "error"
          : phase === "paused"
            ? "paused"
            : "empty";

  const updated =
    status !== null
      ? `Updated ${utcTime(status.asOf)} UTC`
      : checkedAt !== null
        ? "Checked just now"
        : "";

  const triggerDescription =
    phase === "ready"
      ? `${String(count)} models available, ${state === "unknown" ? "health unknown" : state === "operational" ? "all operational" : state === "degraded" ? "some degraded" : "some unavailable"}`
      : triggerLabel;

  return (
    <div className="header-status" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="header-status-trigger"
        data-state={chipState}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${triggerDescription}. Open included AI status.`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="header-status-dot" aria-hidden="true" />
        <span className="header-status-label">{triggerLabel}</span>
        <svg
          className="header-status-chevron"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {/*
        A region, not a dialog. It is a non-modal disclosure: focus stays on the
        trigger, Escape closes it, and nothing behind it is inert. `role="dialog"`
        would promise a focus move this deliberately does not make.
      */}
      {open && (
        <div
          className="header-status-popover"
          id={id}
          role="region"
          aria-label="Included AI status"
          aria-busy={loading}
        >
          <div className="header-status-head">
            <div className="header-status-kicker">
              <span>Included AI</span>
              <span className="header-status-state" data-state={chipState}>
                <i aria-hidden="true" />
                {STATE_LABEL[chipState] ?? chipState}
              </span>
            </div>
            <h2 className="header-status-title">{title}</h2>
            <p className="header-status-sub">{subtitle}</p>
          </div>

          {phase === "loading" && (
            <div className="header-status-skeletons" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div className="header-status-skeleton" key={row}>
                  <span />
                  <span />
                </div>
              ))}
            </div>
          )}

          {phase === "ready" && (
            <div className="header-status-list">
              {rows.map((model) => {
                const note = HEALTH_NOTE[model.health];
                return (
                  <Link
                    key={model.id}
                    href="/status#models"
                    className="header-status-model"
                    title={`${model.name} - ${HEALTH_LABEL[model.health]}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="header-status-model-dot" data-state={model.health} aria-hidden="true" />
                    <span className="header-status-model-copy">
                      <span className="header-status-model-name">{model.name}</span>
                      <span className="header-status-model-meta">
                        {note !== undefined && (
                          <>
                            <b data-state={model.health}>{note}</b>
                            <span aria-hidden="true"> · </span>
                          </>
                        )}
                        {model.providerName}
                        <span aria-hidden="true"> · </span>
                        {formatContext(model.contextWindow)} context
                      </span>
                    </span>
                    <span className="header-status-model-rate" title={model.billing === "wallet" ? "Purchased USD credits, provider cost plus 35%" : `${formatRate(model.creditRate)} credit rate`}>
                      <b>{model.billing === "wallet" ? "Paid" : formatRate(model.creditRate)}</b>
                      <span> credits</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {(phase === "error" || phase === "paused" || phase === "empty") && (
            <div className="header-status-message">
              <p>
                {phase === "paused"
                  ? "Models will appear here again when included AI is turned back on."
                  : phase === "empty"
                    ? "Add a provider key and enable at least one model in the admin panel."
                    : "This control reads the public model directory, so it will recover on its own when the API does."}
              </p>
              <button type="button" className="header-status-retry" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>
                {loading ? "Checking…" : "Try again"}
              </button>
            </div>
          )}

          <div className="header-status-foot">
            <small>{loading && phase !== "loading" ? "Refreshing…" : updated}</small>
            <Link href="/status" className="header-status-link" onClick={() => setOpen(false)}>
              <span>Model status &amp; incidents</span>
              <Icon node={ArrowRight} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
