import type { ModelReport, ModelReportMetrics, ModelReportResponse } from "@adcode/api/src/tagflowReportTypes.ts";
import { AUDIENCE_DIMENSIONS, audienceTitles, audienceLabel } from "@adcode/api/src/modelAudience.ts";
import { toCsv } from "@adcode/api/src/csv.ts";

export const metricLabels: Record<keyof ModelReportMetrics,string> = {
  attempts: "Request demand", providerCalls: "Provider calls", successes: "Successful responses", providerErrors: "Provider errors", relayErrors: "ADCode relay errors", rejected: "ADCode rejections", cancelled: "Cancelled requests", unfinished: "Unfinished telemetry",
  activeUsers: "Active accounts", repeatUsers: "Repeat accounts", newUsers: "New accounts", returningUsers: "Returning accounts", inputTokens: "Input tokens", outputTokens: "Output tokens", costMicros: "Estimated provider cost (USD)", estimatedRequests: "Requests with estimated token usage",
  toolRequests: "Requests offering tools", toolCalls: "Generated tool calls", streamedRequests: "Streaming calls", outputLimitStops: "Replies hitting output limit", refusals: "Provider refusals", peakRpm: "Peak calls per UTC minute", peakTpm: "Peak tokens per UTC start minute", peakConcurrency: "Peak recorded concurrent calls",
  latencySamples: "Latency samples", firstTokenSamples: "First-output samples", throughputSamples: "Output-rate samples", durationP50: "Response latency p50 (ms)", durationP95: "Response latency p95 (ms)", firstTokenP50: "First output p50 (ms)", firstTokenP95: "First output p95 (ms)", inputP50: "Input tokens p50", inputP95: "Input tokens p95", outputP50: "Output tokens p50", outputP95: "Output tokens p95", outputTpsP50: "Observed output rate p50 (tokens/s)", outputTpsP95: "Observed output rate p95 (tokens/s)", helpful: "Helpful ratings", notHelpful: "Not helpful ratings", feedbackUsers: "Feedback respondents",
};
export const metricNumber = (value: number | null): string => value === null ? "Not measured" : value.toLocaleString("en-US",{ maximumFractionDigits: 2 });
export const percent = (top: number,bottom: number): string => bottom > 0 ? `${(top/bottom*100).toFixed(1)}%` : "Not measured";
export const growth = (current: number,previous: number): string => previous > 0 ? `${current >= previous ? "+" : ""}${((current-previous)/previous*100).toFixed(1)}%` : current > 0 ? "No prior baseline" : "No demand in either period";
export const metricValue = (key: keyof ModelReportMetrics,value: number | null): string => key === "costMicros" && value !== null ? `$${(value/1_000_000).toFixed(4)}` : metricNumber(value);
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g,char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]!);
const date = (at: number): string => new Date(at).toISOString().replace("T"," ").replace(".000Z"," UTC");
const table = (headers: string[],rows: unknown[][]): string => `<div class="table-wrap"><table><thead><tr>${headers.map(value => `<th>${escape(value)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

/** A standalone briefing, safe to open offline, print or share. No external scripts/assets. */
export function providerReportHtml(report: ModelReportResponse, models: ModelReport[] = report.models): string {
  const totalDemand = report.models.reduce((total,model) => total+model.current.attempts,0);
  const coverage = report.collectionStartedAt === null ? "Collection has not recorded any model requests yet." : `Collection started ${date(report.collectionStartedAt)}. History before this date cannot be attributed to models.`;
  const partial = report.collectionStartedAt === null || report.collectionStartedAt > report.range.previousFromAt;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADCode free model provider report</title><style>
  *{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;color:#17202b;max-width:1100px;margin:auto;padding:40px;background:#fff}h1{font-size:32px}h2{font-size:26px;margin-top:42px}h3{font-size:18px;margin-top:26px}p{overflow-wrap:anywhere}.meta,.note{color:#526073;font-size:13px}.coverage{border-left:4px solid #9b6a11;background:#fff7e6;padding:14px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid #dce2e9;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eff3f7}.table-wrap{overflow:auto}.model{break-before:page}.chart{display:flex;gap:2px;height:110px;align-items:flex-end;border-bottom:1px solid #bcc5d1;margin:20px 0}.bar{background:#3579ba;min-width:2px;flex:1}.comment{border-left:3px solid #ccd6e2;padding:5px 15px;white-space:pre-wrap}.definitions p{font-size:13px}@media print{body{padding:0;max-width:none}.table-wrap{overflow:visible}th{print-color-adjust:exact}tr{break-inside:avoid}h2,h3{break-after:avoid}.chart{print-color-adjust:exact}.model:first-of-type{break-before:auto}@page{size:A4 landscape;margin:15mm}}
  </style></head><body><h1>ADCode · Free model provider report</h1><p>Observed demand, usage, reliability, performance and voluntary feedback from ADCode's included AI coding service.</p><p class="meta">Period: ${escape(report.range.from)} through ${escape(report.range.to)} (UTC) · Generated ${escape(date(report.generatedAt))}<br>Comparison: ${escape(date(report.range.previousFromAt))} through ${escape(date(report.range.previousToAt))} (exclusive end; same elapsed duration).</p>
  <p class="coverage">${escape(coverage)}${partial ? " This report has partial historical coverage; period comparisons need that context." : ""} Current-day data may still be growing. Tests by administrators are excluded.</p>
  <h2>Models in this briefing</h2>${table(["Model","Provider model","Provider","Demand","Active accounts","Input + output tokens","Provider error rate"],models.map(model => [model.modelName,model.upstreamModel,model.provider,metricNumber(model.current.attempts),metricNumber(model.current.activeUsers),metricNumber(model.current.inputTokens+model.current.outputTokens),percent(model.current.providerErrors,model.current.successes+model.current.providerErrors)]))}
  ${models.map(model => {
    const stats = model.current, previous = model.previous, maximum = Math.max(1,...model.daily.map(day => day.attempts));
    return `<section class="model"><h2>${escape(model.modelName)}</h2><p class="meta">ADCode ID: ${escape(model.modelId)} · Provider: ${escape(model.provider)} · Provider model/revision: ${escape(model.upstreamModel)}</p>
    ${model.configuration ? `<p class="coverage">Current configured context: ${escape(metricNumber(model.configuration.contextWindow))} tokens (${escape(metricNumber(model.configuration.contextWindow/1024))}k). Input ceiling: ${escape(metricNumber(model.configuration.inputLimit))}. Maximum reply: ${escape(metricNumber(model.configuration.outputLimit))} tokens. Input and reply share the context window. Model ${model.configuration.enabled ? "enabled" : "disabled"}.</p>` : '<p class="note">This recorded provider revision is no longer configured; current capacity is unavailable.</p>'}
    <h3>Executive briefing</h3><p>${escape(metricNumber(stats.attempts))} verified-account attempts (${escape(percent(stats.attempts,totalDemand))} of included-model demand) from ${escape(metricNumber(stats.activeUsers))} accounts. Demand change: ${escape(growth(stats.attempts,previous.attempts))}. There were ${escape(metricNumber(stats.successes))} successful responses, ${escape(metricNumber(stats.providerErrors))} provider failures, ${escape(metricNumber(stats.rejected))} ADCode rejections and ${escape(metricNumber(stats.cancelled))} cancellations. Observed provider error rate: ${escape(percent(stats.providerErrors,stats.successes+stats.providerErrors))}.</p>
    <p>Peak observed demand was ${escape(metricNumber(stats.peakRpm))} calls and ${escape(metricNumber(stats.peakTpm))} tokens in a UTC start-minute bucket, with ${escape(metricNumber(stats.peakConcurrency))} concurrent calls. Response latency p95: ${escape(metricNumber(stats.durationP95))} ms (${escape(metricNumber(stats.latencySamples))} samples). Helpful feedback: ${escape(percent(stats.helpful,stats.helpful+stats.notHelpful))} from ${escape(metricNumber(stats.helpful+stats.notHelpful))} voluntary ratings and ${escape(metricNumber(stats.feedbackUsers))} respondents.</p>
    ${stats.attempts === 0 ? '<p class="coverage">No recorded attempts for this model in the selected period. An empty period is not evidence of zero underlying demand before collection.</p>' : ""}
    <h3>Demand, usage and capacity · complete metrics</h3>${table(["Metric","Selected period","Previous period"],Object.entries(metricLabels).map(([key,label]) => [label,metricValue(key as keyof ModelReportMetrics,stats[key as keyof ModelReportMetrics]),metricValue(key as keyof ModelReportMetrics,previous[key as keyof ModelReportMetrics])]))}
    <h3>Daily demand and usage</h3><div class="chart" role="img" aria-label="Daily request demand; full values in the table below">${model.daily.map(day => `<span class="bar" title="${escape(day.day)}: ${escape(day.attempts)} attempts" style="height:${day.attempts/maximum*100}%"></span>`).join("")}</div>
    ${table(["UTC date","Attempts","Active accounts","Successful","Provider errors","ADCode rejected","Input tokens","Output tokens","Helpful","Not helpful"],model.daily.map(day => [day.day,day.attempts,day.activeUsers,day.successes,day.providerErrors,day.rejected,day.inputTokens,day.outputTokens,day.helpful,day.notHelpful]))}
    <h3>Reliability and error breakdown</h3>${model.errors.length ? table(["Stage","Error category","Upstream HTTP status","Count","First observed UTC","Last observed UTC"],model.errors.map(error => [error.outcome,error.code,error.upstreamStatus ?? "Not received",error.count,date(error.firstAt),date(error.lastAt)])) : '<p class="note">No recorded errors in this period.</p>'}
    <h3>Workload and input distribution</h3>${table(["Workload source (client reported)","Attempts"],model.sources.map(item => [item.source,item.requests]))}${table(["Input size band (successful responses)","Requests"],model.inputBands.map(item => [item.band,item.requests]))}${table(["UTC hour of day","Provider calls"],model.hourly.map(item => [item.hour,item.requests]))}
    <h3>Audience, personas and purpose</h3><p class="note">${report.audienceStartedAt != null ? `Country and assistant collection started ${escape(date(report.audienceStartedAt))}. ` : ""}Country is approximate network geography. Role, experience and purpose are optional current self-reports. Group account counts can overlap; unknown fields are shown.</p>
    ${AUDIENCE_DIMENSIONS.map(dimension => { const rows = model.audience?.[dimension] ?? [], measured = rows.filter(row => row.value !== "unknown").reduce((total,row) => total+row.requests,0); return `<h3>${escape(audienceTitles[dimension])}</h3><p class="note">Known for ${escape(metricNumber(measured))} of ${escape(metricNumber(stats.attempts))} attempts (${escape(percent(measured,stats.attempts))} coverage).</p>${rows.length ? table(["Group","Accounts","Attempts","Demand share","Input tokens","Output tokens","Successful","Provider errors","Provider error rate","Previous attempts","Previous accounts"],rows.map(row => [audienceLabel(row.value,dimension),row.activeUsers,row.requests,percent(row.requests,stats.attempts),row.inputTokens,row.outputTokens,row.successes,row.providerErrors,percent(row.providerErrors,row.successes+row.providerErrors),row.previousRequests,row.previousActiveUsers])) : '<p class="note">No audience observations.</p>'}`; }).join("")}
    <h3>Feedback and quality signals</h3>${table(["Feedback topic","Helpful","Not helpful"],model.feedbackCategories.map(item => [item.category,item.helpful,item.notHelpful]))}
    <p class="note">Showing ${model.sharedComments.length} of ${model.sharedCommentCount} comments approved for provider sharing. Comments express user opinions; they are not independent quality benchmarks.</p>
    ${model.sharedComments.map(comment => `<p class="meta">${escape(date(comment.at))} · ${escape(comment.rating)} · ${escape(comment.category)}</p><blockquote class="comment">${escape(comment.comment)}</blockquote>`).join("")}
    </section>`;
  }).join("")}
  <section class="definitions"><h2>Definitions and data limitations</h2>${Object.entries(report.definitions).map(([label,text]) => `<p><strong>${escape(label)}:</strong> ${escape(text)}</p>`).join("")}
  <p>This report does not measure GPU utilization, provider infrastructure cost, scheduled uptime, code correctness, successful tool execution or completed user tasks. It does not invent historical demand or private conversation examples.</p></section></body></html>`;
}

// Spreadsheet formula injection is possible in model names and user-authored comments; csv.ts
// guards every admin export the same way.
export function providerReportCsv(report: ModelReportResponse,models: ModelReport[] = report.models): string {
  const rows: unknown[][] = [["section","provider","model_id","provider_model","period","date","metric","value","unit","category","code","comment"]];
  for (const model of models) {
    const prefix = [model.provider,model.modelId,model.upstreamModel];
    if (model.configuration) for (const [key,value] of Object.entries(model.configuration)) rows.push(["configuration",...prefix,"current","",key,value,"","","",""]);
    for (const dimension of AUDIENCE_DIMENSIONS) for (const segment of model.audience?.[dimension] ?? []) {
      for (const [key,value] of Object.entries(segment)) if (key !== "value") rows.push(["audience",...prefix,key.startsWith("previous") ? "previous" : "current","",key,value,"count",dimension,segment.value,audienceLabel(segment.value,dimension)]);
    }
    for (const period of ["current","previous"] as const) for (const key of Object.keys(metricLabels) as (keyof ModelReportMetrics)[]) rows.push(["summary",...prefix,period,"",key,key === "costMicros" ? model[period][key]/1_000_000 : model[period][key],key === "costMicros" ? "USD" : key.includes("Tps") ? "tokens/s" : /duration|firstTokenP/.test(key) ? "ms" : "count","","",""]);
    for (const day of model.daily) for (const [key,value] of Object.entries(day)) if (key !== "day") rows.push(["daily",...prefix,"current",day.day,key,value,"count","","",""]);
    for (const error of model.errors) rows.push(["error",...prefix,"current",date(error.firstAt),"occurrences",error.count,"count",error.outcome,error.code,`upstream_status=${error.upstreamStatus ?? "none"}; last_seen=${date(error.lastAt)}`]);
    for (const source of model.sources) rows.push(["workload",...prefix,"current","","attempts",source.requests,"count",source.source,"",""]);
    for (const hour of model.hourly) rows.push(["hourly",...prefix,"current",hour.hour,"provider_calls",hour.requests,"count","UTC hour","",""]);
    for (const band of model.inputBands) rows.push(["input_band",...prefix,"current","","requests",band.requests,"count",band.band,"",""]);
    for (const category of model.feedbackCategories) for (const rating of ["helpful","notHelpful"] as const) rows.push(["feedback",...prefix,"current","",rating,category[rating],"count",category.category,"",""]);
    for (const comment of model.sharedComments) rows.push(["shared_comment",...prefix,"current",date(comment.at),comment.rating,"","",comment.category,"",comment.comment]);
  }
  rows.push(["coverage","","","","",report.collectionStartedAt === null ? "Not started" : date(report.collectionStartedAt),"selected_range",`${report.range.from} to ${report.range.to}`,"UTC","","",""]);
  rows.push(["coverage","","","","","","audience_started_at",report.audienceStartedAt == null ? "Not started" : date(report.audienceStartedAt),"UTC","","",""]);
  for (const [name,text] of Object.entries(report.definitions)) rows.push(["definition","","","","","",name,"","","","",text]);
  return toCsv(rows);
}

export function downloadProviderFile(filename: string,body: string,type: string): void {
  const url = URL.createObjectURL(new Blob([body],{ type })), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url),1000);
}

export function printProviderReport(html: string): void {
  const frame = document.createElement("iframe");
  frame.title = "Printable provider report"; frame.style.cssText = "position:fixed;width:1px;height:1px;border:0;left:-10000px";
  frame.setAttribute("sandbox","allow-same-origin allow-modals");
  frame.onload = () => { frame.contentWindow?.addEventListener("afterprint",() => frame.remove(),{ once: true }); frame.contentWindow?.print(); };
  frame.srcdoc = html; document.body.append(frame); window.setTimeout(() => frame.remove(),60_000);
}
