import fs from "node:fs";

const dir = "output";
const files = fs.readdirSync(dir).filter((f) => /report|fresh/i.test(f) && f.endsWith(".json"));
const rows = [];
for (const file of files) {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.reports ?? parsed.rows ?? [];
    for (const row of list) if (row && row.title) rows.push({ file, ...row });
  } catch {
    /* skip */
  }
}

const titles = new Map();
const versions = new Map();
const stream = { total: 0, beforeFirstToken: 0 };
for (const row of rows) {
  titles.set(row.title, (titles.get(row.title) ?? 0) + 1);
  const v = String(row.app_version ?? (String(row.body ?? "").match(/ADCode (\d+\.\d+\.\d+)/)?.[1] ?? "unknown"));
  versions.set(v, (versions.get(v) ?? 0) + 1);
  if (/stream-interrupted/i.test(String(row.body ?? ""))) stream.total++;
}

const lines = [];
lines.push(`reports=${rows.length} files=${files.length}`);
lines.push("");
lines.push("TOP TITLES");
for (const [title, count] of [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  lines.push(`${count}\t${title}`);
}
lines.push("");
lines.push("VERSIONS");
for (const [v, count] of [...versions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  lines.push(`${count}\t${v}`);
}
lines.push("");
lines.push(`stream-interrupted mentions=${stream.total}`);

fs.writeFileSync(`${dir}/.tmp-summary.txt`, `${lines.join("\n")}\n`);
console.log(lines.slice(0, 4).join(" / "));
