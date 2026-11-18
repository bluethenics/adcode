// Charts for the real-model benchmark post, drawn from summary.json (analyze.mjs). Same look as
// the 14 November charts: ADCode in the accent blue, the others in one warm neutral, a label on
// every bar, and the numbers repeated in the post's tables.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const OUT = process.argv[2] ?? "E:/adcode-sourcecode/apps/web/public/images/blog";
mkdirSync(OUT, { recursive: true });
// The experiment row (adcodectx) stays out of the published charts.
const summary = JSON.parse(readFileSync(join(HERE, "summary.json"), "utf8")).summary.filter((row) => ["adcode", "claude", "opencode"].includes(row.harness));
const NAME = { adcode: "ADCode", claude: "Claude Code", opencode: "OpenCode" };
const C = { surface: "#12161d", text: "#eef1f5", muted: "#a9b5c4", faint: "#8c99aa", hairline: "rgba(192,213,239,0.22)", us: "#2f81f7", them: "#c97b5a", model: "#5b6b80" };
const FONT = "font-family=\"Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif\"";
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const frame = (w, h, title, sub, body, desc) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d"><title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc><rect width="${w}" height="${h}" rx="16" fill="${C.surface}"/><g ${FONT}><text x="32" y="44" fill="${C.text}" font-size="20" font-weight="650">${esc(title)}</text><text x="32" y="70" fill="${C.muted}" font-size="14">${esc(sub)}</text>${body}</g></svg>\n`;
const legend = (x, y, items) => items.map(([label, color], i) => `<rect x="${x + i * 190}" y="${y - 10}" width="12" height="12" rx="3" fill="${color}"/><text x="${x + i * 190 + 18}" y="${y}" fill="${C.muted}" font-size="13">${esc(label)}</text>`).join("");

/** One bar per harness, ranked; `split` draws it in two parts (the first part in grey). */
function bars(file, title, sub, rows, value, label, desc, split) {
  const w = 760, left = 150, right = w - 140, top = split ? 112 : 100, rowH = 46, h = top + rows.length * rowH + 36;
  const max = Math.max(...rows.map(value)) * 1.05;
  let body = split ? legend(32, 98, split.legend) : "";
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    const us = row.harness === "adcode";
    const len = Math.max(3, (value(row) / max) * (right - left));
    body += `<text x="${left - 14}" y="${y + 21}" fill="${us ? C.text : C.muted}" font-size="14" text-anchor="end"${us ? " font-weight=\"650\"" : ""}>${esc(NAME[row.harness] ?? row.harness)}</text>`;
    if (split) {
      const first = (split.first(row) / max) * (right - left);
      body += `<rect x="${left}" y="${y + 6}" width="${Math.max(0, first - 1)}" height="24" rx="4" fill="${C.model}"/>`;
      body += `<rect x="${left + first}" y="${y + 6}" width="${Math.max(2, len - first)}" height="24" rx="4" fill="${us ? C.us : C.them}"/>`;
    } else {
      body += `<rect x="${left}" y="${y + 6}" width="${len}" height="24" rx="4" fill="${us ? C.us : C.them}"/>`;
    }
    body += `<text x="${left + len + 10}" y="${y + 23}" fill="${C.text}" font-size="13"${us ? " font-weight=\"650\"" : ""}>${esc(label(row))}</text>`;
  });
  body += `<line x1="${left}" x2="${left}" y1="${top - 2}" y2="${top + rows.length * rowH}" stroke="${C.hairline}"/>`;
  writeFileSync(join(OUT, file), frame(w, h, title, sub, body, desc));
}

const byCost = [...summary].sort((a, b) => (a.costPerSolved ?? Infinity) - (b.costPerSolved ?? Infinity));
bars("real-benchmark-cost.svg", "What a solved task costs", "Real model, cache-adjusted, in input-token equivalents. Lower is better.", byCost,
  (row) => row.costPerSolved ?? 0, (row) => fmt(row.costPerSolved ?? 0),
  byCost.map((row) => `${NAME[row.harness]} ${fmt(row.costPerSolved ?? 0)}`).join(", "));

const byWall = [...summary].sort((a, b) => a.medianWallS - b.medianWallS);
bars("real-benchmark-time.svg", "Where the time goes", "Median task, real model. Grey is the model thinking and writing; colour is the harness.", byWall,
  (row) => row.medianModelS + row.medianHarnessS, (row) => `${row.medianWallS.toFixed(0)} s (harness ${row.medianHarnessS.toFixed(1)} s)`,
  byWall.map((row) => `${NAME[row.harness]}: ${row.medianWallS.toFixed(0)} s, of which harness ${row.medianHarnessS.toFixed(1)} s`).join("; "),
  { first: (row) => row.medianModelS, legend: [["Model time", C.model], ["Harness time", C.us]] });

const byPrompt = [...summary].sort((a, b) => a.medianPrompt - b.medianPrompt);
bars("real-benchmark-tokens.svg", "Input tokens the model was billed for", "Median task, as the model counted them. Lower is better.", byPrompt,
  (row) => row.medianPrompt, (row) => fmt(row.medianPrompt),
  byPrompt.map((row) => `${NAME[row.harness]} ${fmt(row.medianPrompt)}`).join(", "));
console.log("real benchmark charts written to", OUT);
