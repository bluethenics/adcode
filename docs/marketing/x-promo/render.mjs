import { chromium } from "playwright";
import { mkdirSync, rmSync } from "fs";
import { execFileSync } from "child_process";
const [,, W = "1080", H = "1080", out = "out.mp4", fps = "60", only = ""] = process.argv;
const dir = new URL(".", import.meta.url).pathname;
const frames = `${dir}frames_${W}x${H}`;
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
await page.goto(`file://${dir}adcode-promo.html?render=1&w=${W}&h=${H}`);
await page.evaluate(() => window.ready);
const times = only ? only.split(",").map(Number) : null;
const n = times ? times.length : Math.round(5 * +fps);
for (let i = 0; i < n; i++) {
  const t = times ? times[i] : i / +fps;
  await page.evaluate((t) => window.seek(t), t);
  await page.screenshot({ path: `${frames}/f${String(i).padStart(4, "0")}.png` });
}
await browser.close();
if (!times) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", fps, "-i", `${frames}/f%04d.png`,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow",
    "-movflags", "+faststart", `${dir}${out}`], { stdio: "inherit" });
  console.log("wrote", out);
} else console.log("stills in", frames);
