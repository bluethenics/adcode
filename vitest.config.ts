import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "mock-server/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    environment: "node",
    // The pure modules exist to be testable in milliseconds (§2). If the suite ever
    // needs longer than this per test, something has acquired I/O it should not have.
    testTimeout: 10_000,
    reporters: ["default"],
  },
});
