/**
 * The whole wire contract, driven through the Fetch transport.
 *
 * `api.test.ts` runs this same suite against the `node:http` transport. Running it again
 * here is what makes "the API folded into the Next app behaves identically to the one the
 * tests have always covered" a checked fact rather than a hope - and it is checked for
 * every route at once, including the ones with request bodies, CORS preflight and the
 * error mappings, which is exactly where a hand-written shim would be wrong.
 *
 * The little `node:http` server below is scaffolding, not the thing under test: the suite
 * speaks HTTP, so something has to answer on a socket. Everything between that socket and
 * the API goes through `createFetchHandler`.
 */
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { describeContract } from "./contractSuite.ts";
import { createFetchHandler } from "../../src/fetchHandler.ts";
import { createMemoryStore } from "../../src/memoryStore.ts";
import type { TokenVerifier } from "../../src/auth.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    return token === "good" ? { uid: "u-conformance", claims: {} } : null;
  },
};

describeContract("services/api via fetch", async () => {
  const store = createMemoryStore();

  const seed = async (): Promise<void> => {
    await store.putCampaign({
      campaignId: "camp-conformance",
      advertiserId: "adv-1",
      name: "camp-conformance campaign",
      createdAt: 0,
      cpmMicros: 8_000_000n,
      budgetMicros: 10_000_000n,
      targetTags: [],
      status: "active",
    });
    await store.putCreative({
      creativeId: "c-1",
      campaignId: "camp-conformance",
      advertiser: "Acme",
      headline: "Ship faster",
      body: "A tool for teams",
      clickUrl: "https://acme.test/x",
      logoLight: "https://cdn.test/l.png",
      logoDark: "https://cdn.test/d.png",
      status: "approved",
    });
  };

  await seed();
  const handler = createFetchHandler({ store, verifier });

  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks);

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }

      const method = req.method ?? "GET";
      const response = await handler(
        new Request(`http://127.0.0.1${req.url ?? "/"}`, {
          method,
          headers,
          ...(method === "GET" || method === "HEAD" ? {} : { body: raw }),
        }),
      );

      const out: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        out[key] = value;
      });
      res.writeHead(response.status, out);
      res.end(await response.text());
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    async reset() {
      store.reset();
      await seed();
    },
  };
});
