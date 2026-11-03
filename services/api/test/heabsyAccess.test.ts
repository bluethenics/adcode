import { describe, it, expect, vi } from "vitest";
import { heabsyAccess } from "../src/heabsyAccess.ts";
describe("Heabsy authenticated model access",()=>{
 it("uses the fixed gateway and returns only distinct model IDs",async()=>{
  const fetcher=vi.fn(async()=>Response.json({data:[{id:"qwen38"},{id:"qwen38"},{id:"deepseek-v4.1-flash-unc"},{id:"bad id"}]}));
  expect(await heabsyAccess("private-key",fetcher)).toEqual(["deepseek-v4.1-flash-unc","qwen38"]);
  expect(fetcher).toHaveBeenCalledWith("https://api.heabsy.com/v1/models",expect.objectContaining({redirect:"manual",headers:{authorization:"Bearer private-key",accept:"application/json"}}));
 });
 it("rejects missing keys, redirects and invalid or empty catalogues",async()=>{
  const fetcher=vi.fn(async()=>Response.redirect("https://example.com",302));
  expect(await heabsyAccess("",fetcher)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  expect(await heabsyAccess("key",fetcher)).toBeNull();
  expect(await heabsyAccess("key",async()=>Response.json({data:[]}))).toBeNull();
  expect(await heabsyAccess("key",async()=>Response.json({secret:"never expose"}))).toBeNull();
 });
});
