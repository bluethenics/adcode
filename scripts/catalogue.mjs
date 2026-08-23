/**
 * Regenerate the bundled model catalogue.
 *
 * `models.dev` publishes what every provider offers - 194 providers and about four
 * megabytes of it. Fetching that at runtime is the right thing to do and cannot be the
 * *only* thing: the connection screen has to be usable on a first launch with no network,
 * and a model list that is empty until a request succeeds looks broken rather than offline.
 *
 * So a trimmed snapshot ships with the app and the live fetch upgrades it. This regenerates
 * the snapshot; run it when the shipped list has aged:
 *
 *     node scripts/catalogue.mjs
 *
 * Trimmed hard on purpose. Only the providers most people reach for, and only the fields
 * the connection screen and the agent actually read - which turns four megabytes into a
 * file that is reasonable to commit and to parse on every launch.
 *
 * Written as TypeScript rather than JSON so that importing it needs no `resolveJsonModule`
 * and every bundler here treats it as ordinary source.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(HERE, "..", "packages", "ai", "src", "catalogueSnapshot.ts");

/**
 * The providers worth shipping offline.
 *
 * Everything else is one network request away. This list is "what somebody is likely to
 * connect on their first evening", not a judgement about the rest.
 */
const KEEP = [
  "anthropic",
  "openai",
  "google",
  "ollama",
  "openrouter",
  "groq",
  "mistral",
  "deepseek",
  "xai",
  "together",
  "fireworks-ai",
  "cerebras",
  "azure",
  "amazon-bedrock",
  "github-copilot",
];

/** Models per provider, newest first as the source orders them. */
const MAX_MODELS = 40;

async function main() {
  const response = await fetch("https://models.dev/api.json", {
    headers: { "user-agent": "adcode-catalogue-snapshot" },
  });

  if (!response.ok) {
    process.stderr.write(`models.dev answered ${String(response.status)}\n`);
    process.exit(1);
  }

  const all = await response.json();
  const providers = [];

  for (const id of KEEP) {
    const source = all[id];
    if (source === undefined) continue;

    const models = Object.values(source.models ?? {})
      .slice(0, MAX_MODELS)
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        // The two capabilities that change what the editor may do with a model: an agent
        // without tool calls cannot read a file, and reasoning models are worth marking.
        toolCall: model.tool_call === true,
        reasoning: model.reasoning === true,
      }));

    if (models.length === 0) continue;

    providers.push({
      id: source.id ?? id,
      name: source.name ?? id,
      env: Array.isArray(source.env) ? source.env : [],
      doc: typeof source.doc === "string" ? source.doc : null,
      models,
    });
  }

  const snapshot = {
    // Not a version of this file - the date the upstream data was taken, which is what
    // somebody wondering whether the list is stale actually wants to know.
    takenOn: new Date().toISOString().slice(0, 10),
    providers,
  };

  await writeFile(TARGET, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const models = providers.reduce((total, provider) => total + provider.models.length, 0);
  process.stdout.write(
    `catalogue: ${String(providers.length)} providers, ${String(models)} models -> ${join("packages", "ai", "src", "catalogue.snapshot.json")}\n`,
  );
}

await main();
