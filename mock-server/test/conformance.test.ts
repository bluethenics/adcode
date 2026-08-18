/**
 * The mock server, held to the same contract as the real service.
 *
 * Imports from `services/`, not `packages/`, so `mock-server-must-not-import-client`
 * still holds: the mock and the client remain independent.
 */
import { describeContract } from "../../services/api/test/conformance/contractSuite.ts";
import { createMockServer } from "../src/server.ts";

describeContract("mock-server", async () => {
  const server = await createMockServer();

  return {
    url: server.url,
    close: () => server.close(),
    async reset() {
      await fetch(`${server.url}/__test__/reset`, { method: "POST" });
    },
  };
});
