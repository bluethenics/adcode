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
    /* not a report dump */
  }
}

const clean = (body) => {
  const text = String(body ?? "")
    .replace(/\r/g, "")
    .split("--- Debug log ---")[0]
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 240);
};

const wanted = new Set([
  "Assistant: The assistant stopped with an error",
  "Assistant: This conversation is too big for the model",
  "Assistant: No model connected",
  "Assistant: Included AI is having trouble",
  "Not able to use ai",
  "rate limited",
  "Unable to view sub-agent sessions",
  "Assistant: Your signed-in account changed",
]);

const groups = new Map();
for (const row of rows) {
  if (!wanted.has(row.title)) continue;
  const key = `${row.title} :: ${clean(row.body)}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}

const lines = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} x ${key}`);

fs.writeFileSync(`${dir}/.tmp-bodies.txt`, `${rows.length} reports read\n\n${lines.join("\n\n")}\n`);
console.log("wrote", lines.length, "groups from", rows.length, "reports");
