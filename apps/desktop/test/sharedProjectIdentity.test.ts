import { expect, it } from "vitest";
import { sharedProjectAccountKey } from "../src/main/sharedProjectIdentity.ts";
it("keeps malformed and development tokens out of the online project cache", () => {
  for (const token of ["", "dev-token", "header.invalid.signature", "a." + Buffer.from('{"sub":null}').toString("base64url") + ".b"]) expect(sharedProjectAccountKey(token)).toBeNull();
  const token = (uid: string) => "a." + Buffer.from(JSON.stringify({ sub: uid })).toString("base64url") + ".b";
  expect(sharedProjectAccountKey(token("../user"))).toBe(Buffer.from("../user").toString("hex"));
  expect(sharedProjectAccountKey(token("friend"))).not.toBe(sharedProjectAccountKey(token("owner")));
});
