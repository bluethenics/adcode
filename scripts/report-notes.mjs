import fs from "node:fs";

const dir = "output";
const files = fs.readdirSync(dir).filter((f) => /report|fresh/i.test(f) && f.endsWith(".json"));
const rows = [];
for (const file of files) {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.reports ?? parsed.rows ?? [];
    for (const row of list) if (row && row.title) rows.push(row);
  } catch {
    /* skip */
  }
}

const notes = [];
for (const row of rows) {
  const body = String(row.body ?? "").replace(/\r/g, "");
  const cut = body.split("What I asked for:")[0] ?? "";
  const note = cut.replace(/\s+/g, " ").trim();
  if (note.length > 6) notes.push(`${row.title} | ${note.slice(0, 200)}`);
}

const counts = new Map();
for (const note of notes) counts.set(note, (counts.get(note) ?? 0) + 1);

const out = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([note, count]) => `${count} x ${note}`)
  .join("\n");

fs.writeFileSync(`${dir}/.tmp-user-notes.txt`, `${notes.length} reports carried a typed note, of ${rows.length}\n\n${out}\n`);
console.log("notes", notes.length, "distinct", counts.size);
