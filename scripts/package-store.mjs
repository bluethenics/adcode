/**
 * `npm run package:store` - build the .appx ADCode submits to the Microsoft Store.
 *
 * Separate from `npm run package` because a Store package is only useful if its identity
 * matches a reservation in Partner Center exactly, character for character. Get one field
 * wrong and nothing complains until the upload is rejected, twenty minutes later, with a
 * message about a manifest. So the three identity fields are required up front, read from
 * the environment, and checked against the shapes Microsoft actually accepts.
 *
 * Where each value comes from, in Partner Center:
 *
 *   ADCODE_APPX_IDENTITY_NAME     Product > Product identity > Package/Identity/Name
 *   ADCODE_APPX_PUBLISHER         Product > Product identity > Package/Identity/Publisher
 *   ADCODE_APPX_PUBLISHER_NAME    Product > Product identity > Publisher display name
 *
 * The publisher is a full X.500 string beginning `CN=`, not a company name. Copying the
 * display name into it is the single most common way to fail this.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { releaseDirectory } from "./release-directory.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));

/**
 * The identity fields, with the shape each one has to have.
 *
 * `identityName` allows dots because Store identity names usually contain one
 * (`12345Publisher.ADCode`); `applicationId` in electron-builder.yml is the one that
 * must not.
 */
const REQUIRED = [
  {
    env: "ADCODE_APPX_IDENTITY_NAME",
    config: "appx.identityName",
    shape: /^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/,
    hint: "Partner Center > Product identity > Package/Identity/Name, e.g. 12345Publisher.ADCode",
  },
  {
    env: "ADCODE_APPX_PUBLISHER",
    config: "appx.publisher",
    shape: /^CN=.+/,
    hint: "Partner Center > Product identity > Package/Identity/Publisher - the whole string, starting CN=",
  },
  {
    env: "ADCODE_APPX_PUBLISHER_NAME",
    config: "appx.publisherDisplayName",
    shape: /^.{1,255}$/,
    hint: "Partner Center > Product identity > Publisher display name",
  },
];

const missing = [];
const overrides = [];

for (const field of REQUIRED) {
  const value = (process.env[field.env] ?? "").trim();
  if (value.length === 0) {
    missing.push(`  ${field.env}\n      ${field.hint}`);
    continue;
  }
  if (!field.shape.test(value)) {
    missing.push(`  ${field.env} is set but does not look right ("${value}")\n      ${field.hint}`);
    continue;
  }
  overrides.push(`-c.${field.config}=${value}`);
}

if (missing.length > 0) {
  process.stderr.write(
    `Cannot build a Store package yet.\n\n${missing.join("\n")}\n\n` +
      `Set them for this shell and run again:\n` +
      `  $env:ADCODE_APPX_IDENTITY_NAME = "..."\n` +
      `  $env:ADCODE_APPX_PUBLISHER = "CN=..."\n` +
      `  $env:ADCODE_APPX_PUBLISHER_NAME = "..."\n\n` +
      `SETUP.md, "Publish to the Microsoft Store", has the click path that produces them.\n`,
  );
  process.exit(2);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });
}

const binOf = (pkg, ...parts) => join(dirname(require.resolve(`${pkg}/package.json`)), ...parts);

process.stdout.write("Building ADCode...\n");

const grammars = await run(process.execPath, [join(REPO, "scripts", "grammars.mjs"), "--strict"]);
if (grammars !== 0) process.exit(grammars);

const build = await run(process.execPath, [binOf("electron-vite", "bin", "electron-vite.js"), "build"], {
  cwd: join(REPO, "apps", "desktop"),
});

if (build !== 0) {
  process.stderr.write("\nBuild failed - not packaging.\n");
  process.exit(build);
}

const output = releaseDirectory(REPO);
process.stdout.write(`\nPackaging for the Microsoft Store into ${output}...\n`);

const code = await run(process.execPath, [
  binOf("electron-builder", "cli.js"),
  "--win",
  "appx",
  `-c.directories.output=${output}`,
  ...overrides,
  ...process.argv.slice(2),
]);

if (code === 0) {
  process.stdout.write(
    `\nDone. Upload release/ADCode-x64.appx in Partner Center under Packages.\n` +
      `Do not sign it yourself - the Store signs what it distributes, which is the whole\n` +
      `point of going this way.\n`,
  );
}

process.exit(code);
