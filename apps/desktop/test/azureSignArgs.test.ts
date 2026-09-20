import { describe, expect, it } from "vitest";
import { azureCredentialsPresent, azureSignArgs } from "../../../scripts/azure-sign-args.mjs";

const FULL = {
  ADCODE_AZURE_ENDPOINT: "https://eus.codesigning.azure.net/",
  ADCODE_AZURE_ACCOUNT: "bluethenics",
  ADCODE_AZURE_PROFILE: "adcode-public",
  ADCODE_AZURE_PUBLISHER: "Bluethenics",
};

describe("azureSignArgs", () => {
  it("emits the four win.azureSignOptions overrides when every identifier is set", () => {
    expect(azureSignArgs(FULL)).toEqual([
      "-c.win.azureSignOptions.endpoint=https://eus.codesigning.azure.net/",
      "-c.win.azureSignOptions.codeSigningAccountName=bluethenics",
      "-c.win.azureSignOptions.certificateProfileName=adcode-public",
      "-c.win.azureSignOptions.publisherName=Bluethenics",
    ]);
  });

  it("stays unsigned when nothing is configured", () => {
    expect(azureSignArgs({})).toEqual([]);
  });

  it("stays unsigned when any single identifier is missing, blank, or whitespace", () => {
    for (const name of Object.keys(FULL)) {
      expect(azureSignArgs({ ...FULL, [name]: "" }), name).toEqual([]);
      expect(azureSignArgs({ ...FULL, [name]: "   " }), name).toEqual([]);
    }
    const { ADCODE_AZURE_PROFILE: _dropped, ...rest } = FULL;
    expect(azureSignArgs(rest)).toEqual([]);
  });
});

describe("azureCredentialsPresent", () => {
  it("requires tenant, client, and secret together", () => {
    const full = {
      AZURE_TENANT_ID: "tenant",
      AZURE_CLIENT_ID: "client",
      AZURE_CLIENT_SECRET: "secret",
    };
    expect(azureCredentialsPresent(full)).toBe(true);
    expect(azureCredentialsPresent({})).toBe(false);
    expect(azureCredentialsPresent({ ...full, AZURE_CLIENT_SECRET: "  " })).toBe(false);
  });
});
