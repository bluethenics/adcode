import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { sourceProfile } from "../../../scripts/sourceProfile.mjs";

it("keeps local launches in a stable profile separate from the installed app and other checkouts", () => {
  const repository = resolve("source-one"), home = resolve("test-home");
  const env = { LOCALAPPDATA: join(home, "Local") };
  const profile = sourceProfile(repository, env, "win32", home);
  expect(profile.startsWith(join(home, "Local", "ADCode", "SourceProfiles"))).toBe(true);
  expect(sourceProfile(repository, env, "win32", home)).toBe(profile);
  expect(sourceProfile(resolve("source-two"), env, "win32", home)).not.toBe(profile);
  expect(sourceProfile(repository.toUpperCase(), env, "win32", home)).toBe(profile);
});

it("respects an explicit test or user profile and rejects invalid overrides", () => {
  const profile = resolve("explicit-profile");
  expect(sourceProfile(process.cwd(), { ADCODE_USER_DATA_DIR: profile })).toBe(profile);
  for (const invalid of ["", "relative-profile"]) expect(() => sourceProfile(process.cwd(), { ADCODE_USER_DATA_DIR: invalid })).toThrow("absolute profile");
});

it("uses platform application-data locations when Windows environment variables are unavailable", () => {
  const home = resolve("test-home");
  expect(sourceProfile(process.cwd(), {}, "win32", home)).toContain(join(home, "AppData", "Local", "ADCode"));
  expect(sourceProfile(process.cwd(), {}, "darwin", home)).toContain(join(home, "Library", "Application Support", "ADCode"));
  expect(sourceProfile(process.cwd(), {}, "linux", home)).toContain(join(home, ".config", "ADCode"));
});
