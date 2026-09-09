import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Pointer-driven checks shared with the isolated Electron smoke harness. */
export async function checkPopups({ evaluate, send, waitFor, sleep, artifacts }) {
  async function click(selector) {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const box = element.getBoundingClientRect();
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    await sleep(300);
  }
  const shell = (id) => `dialog[data-popup-id="${id}"]`;
  const isOpen = (id) => `document.querySelector('${shell(id)}').open`;
  async function snapshot(name) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
  }
  await click("#open-earnings");
  await sleep(800);
  assert.equal(await evaluate(isOpen("earnings")), true, "Earnings remains open after entry animation");
  await waitFor("document.querySelector('.earnings-card').getAttribute('aria-busy') === 'true' || document.querySelectorAll('.earnings-facts .earnings-row').length >= 4");
  assert.equal(await evaluate(`document.querySelector('.earnings-facts').children.length > 0 || getComputedStyle(document.querySelector('.earnings-facts')).display === 'none'`), true, "Waiting for the server does not render an empty facts card");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${shell("earnings")}')).pointerEvents`), "none", "Anchored root does not block the workspace");
  await snapshot("earnings");

  // One physical click on the next launcher must switch tools, not just dismiss an overlay.
  await click("#open-structure");
  assert.equal(await evaluate(isOpen("structure")), true);
  assert.equal(await evaluate(isOpen("earnings")), false);
  await click('.structure-tab:last-child');
  assert.equal(await evaluate(isOpen("structure")), true, "Switching Structure tabs preserves the popup");
  await snapshot("structure");
  await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 500, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  assert.equal(await evaluate(`(() => {
    const box = document.querySelector('${shell("structure")} .popup-shell-surface').getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight;
  })()`), true, "Anchored popup fits after window resizing");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await click('.activity[data-view="scm"]');
  await waitFor("document.querySelector('.scm-panel').dataset.scmState === 'repo'");
  assert.equal(await evaluate(isOpen("source-control")), true);
  assert.equal(await evaluate(`document.getElementById(document.querySelector('${shell("source-control")}').getAttribute('aria-labelledby')).textContent`), "Source Control");
  await snapshot("git");
  await waitFor("document.querySelectorAll('.scm-github-remote option').length === 1");
  assert.equal(await evaluate("document.querySelectorAll('.scm-github-links button').length"), 13);
  await click('.scm-actions button:nth-last-child(2)');
  await waitFor("document.querySelector('.prompt-dialog').open");
  const dragPoints = await evaluate(`(() => {
    const box = document.querySelector('.prompt-input').getBoundingClientRect();
    return { x: Math.round(box.left + 20), y: Math.round(box.top + box.height / 2) };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...dragPoints, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 3, y: 3, button: "left", clickCount: 1 });
  assert.equal(await evaluate("document.querySelector('.prompt-dialog').open"), true, "Dragging from a prompt preserves it");
  await click('.prompt-dialog .confirm-cancel');
  assert.equal(await evaluate(isOpen("source-control")), true);
  await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 640, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  assert.equal(await evaluate(`(() => {
    const box = document.querySelector('.scm-commit-region').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  })()`), true, "Git commit workspace fits a narrow window");
  await snapshot("git-narrow");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // Empty commit opens the real result dialog without writing a commit.
  await click('.scm-commit button[type="submit"]');
  await waitFor("document.querySelector('.result-dialog').open");
  await click('.result-summary');
  assert.equal(await evaluate(isOpen("source-control")), true, "Clicking a nested result keeps Git open");
  await click('.result-close');
  assert.equal(await evaluate(isOpen("source-control")), true, "Dismissing the result returns to Git");

  await click('.scm-close');
  assert.equal(await evaluate(isOpen("source-control")), false);
  await click("#open-earnings");
  await click("#open-earnings");
  assert.equal(await evaluate(isOpen("earnings")), false, "Same launcher toggles an anchored popup closed");
  await evaluate("window.adcode.settings.write('adcode.appearance.theme', 'light')");
  for (const [selector, name] of [["#open-earnings", "earnings"], ["#open-structure", "structure"], ['.activity[data-view="scm"]', "git"]]) {
    await click(selector);
    await snapshot(`${name}-light`);
  }
  process.stdout.write("PASS: Earnings/Structure/Git remain open, launchers switch in one click, tabs work, anchored resize fits, nested Git results preserve their parent.\n");
}
