#!/usr/bin/env node
/**
 * Fetch what rendering the ad needs, into the ignored `.tools/` beside this file:
 *
 *   ffmpeg   - the static build the `ffmpeg-static` package ships, taken straight from its
 *              GitHub release, so encoding never becomes a dependency of the repository.
 *   fonts    - the latin subsets of Inter Tight, Inter and JetBrains Mono (the website's
 *              three families), as variable woff2, plus a fonts.css that points at them.
 *
 *   node marketing/ad-payback/fetch-tools.mjs
 *
 * Idempotent: anything already present is kept.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const here = import.meta.dirname;
const tools = join(here, ".tools");
const fonts = join(tools, "fonts");

const FFMPEG_RELEASE = "b6.1.1";
const platform = `${process.platform}-${process.arch}`;
const ffmpegPath = join(tools, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

const FAMILIES = [
  { family: "Inter Tight", query: "Inter+Tight:wght@400..900", file: "inter-tight.woff2" },
  { family: "Inter", query: "Inter:wght@400..700", file: "inter.woff2" },
  { family: "JetBrains Mono", query: "JetBrains+Mono:wght@400..700", file: "jetbrains-mono.woff2" },
];
// Google serves woff2 only to a browser it recognises.
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function download(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchFfmpeg() {
  if (existsSync(ffmpegPath)) return console.log(`ffmpeg: already at ${ffmpegPath}`);
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-${platform}.gz`;
  console.log(`ffmpeg: downloading ${url}`);
  const binary = gunzipSync(await download(url));
  await writeFile(ffmpegPath, binary, { mode: 0o755 });
  console.log(`ffmpeg: ${(binary.length / 1e6).toFixed(1)} MB at ${ffmpegPath}`);
}

async function fetchFonts() {
  await mkdir(fonts, { recursive: true });
  const faces = [];
  for (const { family, query, file } of FAMILIES) {
    const target = join(fonts, file);
    const css = (await download(`https://fonts.googleapis.com/css2?family=${query}&display=block`, { "user-agent": BROWSER })).toString("utf8");
    // Each subset is its own @font-face after a /* subset */ comment; only latin is needed.
    const latin = /\/\* latin \*\/\s*@font-face\s*{([^}]*)}/.exec(css)?.[1];
    const src = latin && /url\((https:[^)]+\.woff2)\)/.exec(latin)?.[1];
    const weight = latin && /font-weight:\s*([\d ]+);/.exec(latin)?.[1];
    if (!src || !weight) throw new Error(`no latin woff2 for ${family}`);
    if (!existsSync(target)) await writeFile(target, await download(src));
    faces.push(`@font-face {\n  font-family: "${family}";\n  font-style: normal;\n  font-weight: ${weight.trim()};\n  font-display: block;\n  src: url("./${file}") format("woff2");\n}\n`);
    console.log(`font: ${family} (${weight.trim()}) → ${file}`);
  }
  await writeFile(join(fonts, "fonts.css"), faces.join("\n"));
}

await mkdir(tools, { recursive: true });
await fetchFfmpeg();
await fetchFonts();
console.log("tools ready");
