import { describeContract } from "./contractSuite.ts";
import { createApiServer } from "../../src/server.ts";
import { createMemoryStore } from "../../src/memoryStore.ts";
import type { TokenVerifier } from "../../src/auth.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    return token === "good" ? { uid: "u-conformance", claims: {} } : null;
  },
};

describeContract("services/api", async () => {
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
  const server = await createApiServer({ store, verifier });

  return {
    url: server.url,
    close: () => server.close(),
    async reset() {
      // Clears balances and receipts between cases, then puts the inventory back. Without
      // the re-seed every serve assertion would run against an empty pool and pass
      // vacuously, which is the failure mode a conformance suite most needs to avoid.
      store.reset();
      await seed();
    },
  };
});
