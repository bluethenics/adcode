import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps team sessions, drafts, safe text and narrow layouts usable in Chromium",()=>{
  const env={...process.env}; delete env["ELECTRON_RUN_AS_NODE"];
  const run=spawnSync(createRequire(import.meta.url)("electron") as string,[fileURLToPath(new URL("./fixtures/sharedWorkspace.cjs",import.meta.url))],{env,encoding:"utf8",timeout:30000,windowsHide:true});
  expect(run.status,run.stdout+run.stderr||String(run.error)).toBe(0);
},35000);
