#!/usr/bin/env node
/** One entry point: `adcode` is the terminal app; `adcode app` opens the editor. */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createLaunchPlan } from "./cli-launcher.mjs";

try {
  const plan = createLaunchPlan(process.argv.slice(2));
  if (plan.preview) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (plan.kind === "terminal") {
    // Keep one process in charge of the console and keyboard throughout the app.
    await import(pathToFileURL(plan.args[0]).href);
  } else {
    const child = spawn(plan.executable, plan.args, {
      cwd: plan.cwd,
      stdio: "inherit",
      env: plan.kind === "desktop" ? { ...process.env, ELECTRON_RUN_AS_NODE: undefined } : process.env,
      shell: false,
    });
    child.once("error", (error) => {
      process.stderr.write(`adcode: could not start ${plan.command} - ${error.message}\n`);
      process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
      process.exitCode = signal === "SIGINT" ? 130 : signal !== null ? 1 : (code ?? 0);
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const args = process.argv.slice(2);
  const boundary = args.indexOf("--");
  if ((boundary < 0 ? args : args.slice(0, boundary)).includes("--json")) {
    process.stdout.write(`${JSON.stringify({ command: args.find((arg) => !arg.startsWith("-")) ?? "adcode", error: { message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`adcode: ${message}\n`);
  }
  process.exitCode = 2;
}
