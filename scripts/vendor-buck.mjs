/*
 * Copies Buck, the mascot, from the desktop app into the website.
 *
 * The site is a separate Next project on a volume with no symlinks, and it may not import the
 * desktop's sources, so it carries a copy. The copy is exact - drawing, moods and stylesheet -
 * and `apps/web/test/buckSync.test.ts` fails when the two differ, which is the reminder to run:
 *
 *   node scripts/vendor-buck.mjs
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
copyFileSync(join(REPO, "apps/desktop/src/renderer/mascot/adcodeMascot.ts"), join(REPO, "apps/web/src/components/buck/adcodeMascot.ts"));
copyFileSync(join(REPO, "apps/desktop/src/renderer/styles/adcodeMascot.css"), join(REPO, "apps/web/src/components/buck/adcodeMascot.css"));
console.log("[vendor-buck] apps/web/src/components/buck is up to date");
