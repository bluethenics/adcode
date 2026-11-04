"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { ModelReport, ModelReportMetrics, ModelReportResponse } from "@adcode/api/src/tagflowReportTypes.ts";
import { AUDIENCE_DIMENSIONS, audienceTitles, audienceLabel } from "@adcode/api/src/modelAudience.ts";
import { downloadProviderFile, growth, metricLabels, metricNumber, metricValue, percent, printProviderReport, providerReportCsv, providerReportHtml } from "@/lib/modelReportExport";
import "./freeModelReports.css";

const keyOf = (model: ModelReport): string => JSON.stringify([model.provider,model.modelId,model.upstreamModel]);
const utcToday = (): string => new Date().toISOString().slice(0,10);
const periodStart = (days: number): string => new Date(Date.parse(utcToday())-(days-1)*86_400_000).toISOString().slice(0,10);
const duration = (ms: number | null): string => ms === null ? "Not measured" : `${(ms/1000).toFixed(2)}s`;
const money = (micros: number): string => `$${(micros/1_000_000).toFixed(4)}`;
function Stat({ label,value,note }: { label: string; value: string; note: string }) { return <div className="model-report-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Table({ label,headers,rows }: { label: string; headers: string[]; rows: (string | number)[][] }) {
  return <div className="model-report-table" role="region" aria-label={label} tabIndex={0}><table><thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.map((row,index) => <tr key={index}>{row.map((cell,index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

export function ModelReportDetail({ model,report }: { model: ModelReport; report: ModelReportResponse }) {
  const value = model.current, previous = model.previous, ratings = value.helpful+value.notHelpful;
  const maxDemand = Math.max(1,...model.daily.map(day => day.attempts));
  return <article className="model-report-detail">
    <header><h2>{model.modelName}</h2><p className="row-sub">{model.provider} · ADCode ID: {model.modelId} · Provider model/revision: {model.upstreamModel}</p><p className="row-sub">{report.range.from} through {report.range.to} · UTC</p>{model.configuration && <p className="model-report-coverage">Configured context window: <strong>{metricNumber(model.configuration.contextWindow)} tokens ({metricNumber(model.configuration.contextWindow/1024)}k)</strong> · Input ceiling: {metricNumber(model.configuration.inputLimit)} · Maximum reply: {metricNumber(model.configuration.outputLimit)} tokens. Replies share the context window with input. Current settings; {model.configuration.enabled ? "enabled" : "disabled"}.</p>}</header>
    {value.attempts === 0 && <p className="model-report-coverage">No recorded requests in this period. This model still has a report; older per-model demand cannot be reconstructed from account totals.</p>}
    <div className="model-report-stats">
      <Stat label="Request demand" value={metricNumber(value.attempts)} note={`${growth(value.attempts,previous.attempts)} vs previous period`} />
      <Stat label="Active accounts" value={metricNumber(value.activeUsers)} note={`${value.newUsers} new · ${value.returningUsers} returning · ${value.repeatUsers} repeat`} />
      <Stat label="Tokens used" value={metricNumber(value.inputTokens+value.outputTokens)} note={`${metricNumber(value.inputTokens)} in · ${metricNumber(value.outputTokens)} out`} />
      <Stat label="Provider error rate" value={percent(value.providerErrors,value.successes+value.providerErrors)} note={`${value.providerErrors} provider errors · ${value.rejected} ADCode rejections`} />
      <Stat label="Response latency p95" value={duration(value.durationP95)} note={`${value.latencySamples} successful-response samples`} />
      <Stat label="Helpful feedback" value={percent(value.helpful,ratings)} note={`${ratings} ratings · ${value.feedbackUsers} respondents`} />
    </div>
    <section><h3>Demand and capacity</h3><div className="model-report-stats">
      <Stat label="Peak requests / minute" value={metricNumber(value.peakRpm)} note="Provider calls in fixed UTC minute buckets" />
      <Stat label="Peak tokens / minute" value={metricNumber(value.peakTpm)} note="Total tokens attributed to each call's start minute" />
      <Stat label="Peak concurrent calls" value={metricNumber(value.peakConcurrency)} note="Recorded provider-call intervals" />
    </div><div className="model-report-chart" role="img" aria-label="Daily request demand; exact values in the daily table below">{model.daily.map(day => <span key={day.day} title={`${day.day}: ${day.attempts} attempts, ${day.activeUsers} accounts`} style={{ height: `${day.attempts/maxDemand*100}%` }} />)}</div><p className="row-sub">Daily demand, UTC · {model.daily[0]?.day ?? report.range.from} to {model.daily.at(-1)?.day ?? report.range.to}</p>
    <details><summary>Daily requests, users, tokens and feedback</summary><Table label="Daily model metrics" headers={["UTC date","Attempts","Accounts","Successful","Provider errors","Rejected","Input tokens","Output tokens","Helpful","Not helpful"]} rows={model.daily.map(day => [day.day,day.attempts,day.activeUsers,day.successes,day.providerErrors,day.rejected,metricNumber(day.inputTokens),metricNumber(day.outputTokens),day.helpful,day.notHelpful])} /></details></section>
    <section><h3>Usage and performance</h3><div className="model-report-stats">
      <Stat label="First output p50 / p95" value={`${duration(value.firstTokenP50)} / ${duration(value.firstTokenP95)}`} note={`${value.firstTokenSamples} streaming samples; text or tool output`} />
      <Stat label="Observed output speed p50" value={value.outputTpsP50 === null ? "Not measured" : `${metricNumber(value.outputTpsP50)} tokens/s`} note={`${value.throughputSamples} reported-usage samples; includes network effects`} />
      <Stat label="Estimated provider spend" value={money(value.costMicros)} note={`${value.estimatedRequests} requests have estimated token counts`} />
    </div><Table label="Input token distribution" headers={["Successful input size","Requests"]} rows={model.inputBands.map(item => [item.band,item.requests])} /><Table label="Workload sources" headers={["Workload source (client reported)","Attempts"]} rows={model.sources.map(item => [item.source,item.requests])} />
    <p className="row-sub">{value.toolRequests} calls offered tools · {value.toolCalls} generated tool calls · {value.outputLimitStops} replies hit the output limit · {value.refusals} provider refusals. Tool execution success and answer correctness are not inferred.</p></section>
    <section><h3>Audience, personas and purpose</h3><p className="row-sub">Country describes the network connection. User role, experience and primary purpose come from an optional survey. Assistant categories and workflows describe features used. Unknown data is included; account counts can overlap between groups.</p>{report.audienceStartedAt != null && <p className="row-sub">Country and assistant metadata collection started {new Date(report.audienceStartedAt).toISOString()}. Older requests and clients may have unknown fields.</p>}
    {AUDIENCE_DIMENSIONS.map(dimension => {
      const rows = model.audience?.[dimension] ?? [], measured = rows.filter(row => row.value !== "unknown").reduce((total,row) => total+row.requests,0);
      return <div key={dimension}><h4>{audienceTitles[dimension]}</h4><p className="row-sub">Known for {metricNumber(measured)} of {metricNumber(value.attempts)} attempts ({percent(measured,value.attempts)} coverage).</p>{rows.length ? <Table label={audienceTitles[dimension]} headers={["Group","Accounts","Attempts","Demand share","Input tokens","Output tokens","Provider error rate","Previous attempts","Previous accounts"]} rows={rows.map(row => [audienceLabel(row.value,dimension),row.activeUsers,row.requests,percent(row.requests,value.attempts),metricNumber(row.inputTokens),metricNumber(row.outputTokens),percent(row.providerErrors,row.successes+row.providerErrors),row.previousRequests,row.previousActiveUsers])} /> : <p className="row-sub">No audience observations in this period.</p>}</div>;
    })}</section>
    <section><h3>Reliability and errors</h3><p className="row-sub">{value.successes} successful · {value.providerErrors} provider errors · {value.relayErrors} relay errors · {value.rejected} ADCode rejections · {value.cancelled} cancellations · {value.unfinished} unfinished telemetry records.</p>
    {model.errors.length ? <Table label="Model error breakdown" headers={["Stage","Error","Provider HTTP status","Count","First seen UTC","Last seen UTC"]} rows={model.errors.map(error => [error.outcome,error.code,error.upstreamStatus ?? "Not received",error.count,new Date(error.firstAt).toISOString(),new Date(error.lastAt).toISOString()])} /> : <p className="row-sub">No recorded errors in this period.</p>}</section>
    <section><h3>Feedback and quality signals</h3><p className="row-sub">{value.helpful} helpful · {value.notHelpful} not helpful · {value.feedbackUsers} respondents. These are voluntary user opinions.</p><Table label="Feedback topics" headers={["Topic","Helpful","Not helpful"]} rows={model.feedbackCategories.map(item => [item.category,item.helpful,item.notHelpful])} />
    <p className="row-sub">{model.sharedComments.length} of {model.sharedCommentCount} comments approved for provider sharing.</p>{model.sharedComments.map((comment,index) => <blockquote className="model-report-comment" key={index}><small>{new Date(comment.at).toISOString()} · {comment.rating} · {comment.category}</small><p>{comment.comment}</p></blockquote>)}</section>
    <details><summary>All metrics and period comparison</summary><Table label="Full model metrics" headers={["Metric","Selected period","Previous period"]} rows={(Object.keys(metricLabels) as (keyof ModelReportMetrics)[]).map(key => [metricLabels[key],metricValue(key,value[key]),metricValue(key,previous[key])])} /></details>
    <details><summary>Hourly provider demand (UTC)</summary><Table label="Hourly demand" headers={["UTC hour of day","Provider calls"]} rows={model.hourly.map(item => [item.hour,item.requests])} /></details>
  </article>;
}

type Loaded = ModelReportResponse & { scope?: "summary" | "model"; builtAt?: number };

/**
 * Every model's headline figures load first, and one model's full report as it is opened.
 *
 * The page used to ask for every model's complete report in one request. At 825,000 recorded
 * requests that took the database past its time limit, so the page never loaded at all. Full
 * reports are fetched per model and kept for the session; "Download all" builds them one by one.
 */
export function FreeModelReports() {
  const { token } = useAuth();
  const [from,setFrom] = useState(() => periodStart(30)), [to,setTo] = useState(utcToday);
  const [draftFrom,setDraftFrom] = useState(from), [draftTo,setDraftTo] = useState(to);
  const [refresh,setRefresh] = useState(0), [selected,setSelected] = useState("");
  const [report,setReport] = useState<Loaded | null>(null), [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [details,setDetails] = useState<Record<string, ModelReport>>({});
  const [detailState,setDetailState] = useState<{ key: string; loading: boolean; error: string }>({ key: "", loading: false, error: "" });
  const [progress,setProgress] = useState("");
  const fresh = useRef(false);

  const request = useCallback(async (query: string, signal?: AbortSignal): Promise<Loaded> => {
    // The admin panel's made-up data for building it (adminPreview.ts). Dead code in a production build.
    if (process.env["NODE_ENV"] === "development") {
      const preview = (await import("@/lib/adminFixtures")).previewResponse<Loaded>("/admin/tagflow/reports", "GET");
      if (preview !== null) { if (preview.ok) return preview.value; throw new Error("Preview data has no reports."); }
    }
    const idToken = await token(); if (idToken === null) throw new Error("Sign in again to view provider reports.");
    const response = await fetch(`/v1/admin/tagflow/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${query}`,{ headers: { authorization: `Bearer ${idToken}` }, ...(signal ? { signal } : {}) });
    const result = await response.json() as Loaded & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "Provider reports could not be loaded. Try again.");
    return result;
  },[token,from,to]);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(""); setDetails({});
    const force = fresh.current; fresh.current = false;
    void request(force ? "&fresh=1" : "",controller.signal).then(result => {
      if (!active) return;
      setReport(result);
      const requested = new URLSearchParams(window.location.search).get("model");
      const fallback = result.models.find(model => model.modelId === requested) ?? result.models[0];
      setSelected(previous => result.models.some(model => keyOf(model) === previous) ? previous : fallback ? keyOf(fallback) : "");
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Provider reports could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  },[request,refresh]);

  const detailQuery = (model: ModelReport, force = false): string =>
    `&provider=${encodeURIComponent(model.provider)}&model=${encodeURIComponent(model.modelId)}&upstream=${encodeURIComponent(model.upstreamModel)}${force ? "&fresh=1" : ""}`;
  const loadDetail = useCallback(async (model: ModelReport, force = false): Promise<ModelReport> => {
    const result = await request(detailQuery(model, force));
    const full = result.models.find(one => keyOf(one) === keyOf(model)) ?? model;
    setDetails(previous => ({ ...previous, [keyOf(model)]: full }));
    return full;
  },[request]);

  const summaryModel = report?.models.find(model => keyOf(model) === selected) ?? null;
  const model = summaryModel === null ? null : details[selected] ?? null;
  useEffect(() => {
    if (summaryModel === null || details[keyOf(summaryModel)] !== undefined) return;
    let active = true;
    setDetailState({ key: keyOf(summaryModel), loading: true, error: "" });
    void loadDetail(summaryModel)
      .then(() => { if (active) setDetailState(state => ({ ...state, loading: false })); })
      .catch(cause => { if (active) setDetailState(state => ({ ...state, loading: false, error: cause instanceof Error ? cause.message : "This model's report could not be loaded." })); });
    return () => { active = false; };
  },[summaryModel,details,loadDetail]);

  async function exportFile(format: "html" | "csv" | "json",all: boolean): Promise<void> {
    if (!report || loading || error) return;
    let models: ModelReport[];
    if (all) {
      models = [];
      try {
        for (const [index, one] of report.models.entries()) {
          setProgress(`Preparing ${index + 1} of ${report.models.length}: ${one.modelName}…`);
          models.push(details[keyOf(one)] ?? await loadDetail(one));
        }
      } catch (cause) { setProgress(cause instanceof Error ? `Stopped: ${cause.message}` : "Stopped: a model's report could not be loaded."); return; }
      setProgress("");
    } else {
      if (model === null) return;
      models = [model];
    }
    const suffix = all ? "all-free-models" : "selected-free-model";
    const filename = `adcode-provider-report-${suffix}-${report.range.from}-${report.range.to}.${format}`;
    const body = format === "html" ? providerReportHtml(report,models) : format === "csv" ? providerReportCsv(report,models) : JSON.stringify({ ...report,models },null,2);
    downloadProviderFile(filename,body,format === "html" ? "text/html;charset=utf-8" : format === "csv" ? "text/csv;charset=utf-8" : "application/json");
  }
  const unavailable = !report || loading || !!error || progress !== "";
  const busyDetail = detailState.loading && detailState.key === selected;
  const built = report?.builtAt === undefined ? null : new Date(report.builtAt);
  return <div className="free-model-reports">
    <form className="model-report-toolbar" onSubmit={event => { event.preventDefault(); setFrom(draftFrom); setTo(draftTo); setRefresh(value => value+1); }}><label>From (UTC)<input className="input" type="date" required value={draftFrom} max={draftTo} onChange={event => setDraftFrom(event.target.value)} /></label><label>To (UTC)<input className="input" type="date" required value={draftTo} min={draftFrom} max={utcToday()} onChange={event => setDraftTo(event.target.value)} /></label><button className="btn btn-primary" disabled={loading}>Apply dates</button><button type="button" className="btn" disabled={loading} onClick={() => { fresh.current = true; setRefresh(value => value+1); }}>Rebuild figures</button>{[7,30,90].map(days => <button type="button" className="btn" key={days} disabled={loading} onClick={() => { const start = periodStart(days), end = utcToday(); setDraftFrom(start); setDraftTo(end); setFrom(start); setTo(end); setRefresh(value => value+1); }}>Last {days} days</button>)}</form>
    {loading && <p role="status">Loading every model's figures…</p>}{error && <p className="notice" role="alert">{error}</p>}
    {progress && <p role="status" className="notice">{progress}</p>}
    {report && <>
      <p className="model-report-coverage">{built !== null && <>Figures built {built.toISOString().slice(0,16).replace("T"," ")} UTC; Rebuild figures recounts them now. </>}{report.collectionStartedAt === null ? "Model-level collection has not started yet." : `Model-level collection started ${new Date(report.collectionStartedAt).toISOString()}.`} Earlier account totals cannot be reconstructed per model. {report.collectionStartedAt === null || report.collectionStartedAt > report.range.previousFromAt ? "Period comparisons have partial historical coverage. " : ""}Admin tests are excluded; current-day figures are still growing.</p>
      <section><header className="model-report-toolbar"><h2>All free models</h2><button className="btn" disabled={unavailable} onClick={() => void exportFile("html",true)}>Download all provider reports</button><button className="btn" disabled={unavailable} onClick={() => void exportFile("csv",true)}>Export all CSV</button></header>
      <Table label="All free model demand and reliability" headers={["Model","Provider","Attempts","Accounts","Tokens","Provider error rate","Helpful ratings"]} rows={report.models.map(model => [model.modelName,model.provider,model.current.attempts,model.current.activeUsers,metricNumber(model.current.inputTokens+model.current.outputTokens),percent(model.current.providerErrors,model.current.successes+model.current.providerErrors),`${model.current.helpful} / ${model.current.helpful+model.current.notHelpful}`])} />
      {report.models.length === 0 && <p className="row-sub">No free models are configured or recorded yet. Add a model in Free models to begin.</p>}</section>
      {summaryModel && <><div className="model-report-toolbar"><label>Model and provider revision<select className="select" value={selected} onChange={event => setSelected(event.target.value)}>{report.models.map(model => <option key={keyOf(model)} value={keyOf(model)}>{model.modelName} · {model.provider} · {model.upstreamModel}</option>)}</select></label><button className="btn btn-primary" disabled={unavailable || model === null} onClick={() => void exportFile("html",false)}>Download provider briefing</button><button className="btn" disabled={unavailable || model === null} onClick={() => model && printProviderReport(providerReportHtml(report,[model]))}>Print / save PDF</button><button className="btn" disabled={unavailable || model === null} onClick={() => void exportFile("csv",false)}>CSV</button><button className="btn" disabled={unavailable || model === null} onClick={() => void exportFile("json",false)}>JSON</button></div>
        {busyDetail && <p role="status" className="model-report-coverage">Building {summaryModel.modelName}'s full report. The busiest models take up to a minute the first time; after that it opens at once.</p>}
        {!busyDetail && detailState.key === selected && detailState.error && <p className="notice" role="alert">{detailState.error} <button type="button" className="btn btn-small" onClick={() => { setDetailState({ key: "", loading: false, error: "" }); setDetails(previous => { const next = { ...previous }; delete next[selected]; return next; }); }}>Try again</button></p>}
        {model && <ModelReportDetail model={model} report={report} />}</>}
      <section><h3>Definitions and coverage</h3><p className="row-sub">Generated {new Date(report.generatedAt).toISOString()} · Compared with {new Date(report.range.previousFromAt).toISOString()} through {new Date(report.range.previousToAt).toISOString()} (exclusive end).</p>{Object.entries(report.definitions).map(([label,text]) => <details key={label}><summary>{label}</summary><p className="row-sub">{text}</p></details>)}<p className="row-sub">Downloads are ready to share. They contain no account identifiers, prompts, replies, code or API keys. Only comments approved for provider sharing are included.</p></section>
    </>}
  </div>;
}
