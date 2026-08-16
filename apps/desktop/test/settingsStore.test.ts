import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSettingsStore } from "../src/main/settingsStore.ts";
import { SETTINGS_VERSION, defaultSettings } from "@adcode/settings";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-settings-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const settingsFile = (): string => join(dir, "settings.json");

describe("first run", () => {
  it("returns defaults when nothing is on disk", async () => {
    const store = createSettingsStore(dir);
    expect(await store.read()).toEqual(defaultSettings());
  });

  it("writes nothing until a setting actually changes", async () => {
    const store = createSettingsStore(dir);
    await store.read();

    await expect(readFile(settingsFile(), "utf8")).rejects.toThrow();
  });
});

describe("persistence", () => {
  it("survives a restart", async () => {
    const first = createSettingsStore(dir);
    await first.write("adcode.editing.minimap", false);
    await first.write("adcode.ads.frequency", "light");

    const second = createSettingsStore(dir);
    const values = await second.read();

    expect(values["adcode.editing.minimap"]).toBe(false);
    expect(values["adcode.ads.frequency"]).toBe("light");
    expect(values["adcode.editing.stickyScroll"]).toBe(true);
  });

  it("stamps the schema version so a later build can migrate", async () => {
    const store = createSettingsStore(dir);
    await store.write("adcode.editing.minimap", false);

    const raw = JSON.parse(await readFile(settingsFile(), "utf8"));
    expect(raw.version).toBe(SETTINGS_VERSION);
  });

  it("leaves no temporary file behind", async () => {
    const store = createSettingsStore(dir);
    await store.write("adcode.editing.minimap", false);

    await expect(readFile(`${settingsFile()}.tmp`, "utf8")).rejects.toThrow();
  });
});

describe("damaged files", () => {
  it("falls back to defaults on unparseable JSON rather than throwing", async () => {
    await writeFile(settingsFile(), "{not json", "utf8");

    const store = createSettingsStore(dir);
    await expect(store.read()).resolves.toEqual(defaultSettings());
  });

  it("falls back to defaults when the file is not an object", async () => {
    await writeFile(settingsFile(), '"a string"', "utf8");

    const store = createSettingsStore(dir);
    await expect(store.read()).resolves.toEqual(defaultSettings());
  });

  it("keeps the valid keys and defaults the rest", async () => {
    await writeFile(
      settingsFile(),
      JSON.stringify({
        version: SETTINGS_VERSION,
        values: {
          "adcode.editing.minimap": false,
          "adcode.editing.stickyScroll": "not a boolean",
          "adcode.nonexistent.setting": true,
        },
      }),
      "utf8",
    );

    const store = createSettingsStore(dir);
    const values = await store.read();

    expect(values["adcode.editing.minimap"]).toBe(false);
    expect(values["adcode.editing.stickyScroll"]).toBe(true);
    expect("adcode.nonexistent.setting" in values).toBe(false);
  });

  it("discards settings written by a newer build rather than guessing", async () => {
    await writeFile(
      settingsFile(),
      JSON.stringify({ version: SETTINGS_VERSION + 5, values: { "adcode.editing.minimap": false } }),
      "utf8",
    );

    const store = createSettingsStore(dir);
    expect(await store.read()).toEqual(defaultSettings());
  });

  it("recovers when the settings directory does not exist yet", async () => {
    const nested = join(dir, "does", "not", "exist");
    const store = createSettingsStore(nested);

    await expect(store.write("adcode.editing.minimap", false)).resolves.toBeDefined();
    expect((await createSettingsStore(nested).read())["adcode.editing.minimap"]).toBe(false);
  });
});

describe("write validation", () => {
  it("ignores an unknown setting id", async () => {
    const store = createSettingsStore(dir);
    const values = await store.write("adcode.nope", true);

    expect("adcode.nope" in values).toBe(false);
  });

  it("ignores a wrongly-typed value", async () => {
    const store = createSettingsStore(dir);
    const values = await store.write("adcode.editing.minimap", "yes");

    expect(values["adcode.editing.minimap"]).toBe(true);
  });

  it("ignores an out-of-range enum value", async () => {
    const store = createSettingsStore(dir);
    const values = await store.write("adcode.ads.frequency", "constant");

    expect(values["adcode.ads.frequency"]).toBe("standard");
  });
});

describe("change notification", () => {
  it("announces writes, so the ad service and editor pick them up without a restart", async () => {
    const store = createSettingsStore(dir);
    const seen: Array<boolean | string | undefined> = [];
    store.onChanged((values) => seen.push(values["adcode.ads.enabled"]));

    await store.write("adcode.ads.enabled", false);

    expect(seen).toEqual([false]);
  });

  it("announces a reset", async () => {
    const store = createSettingsStore(dir);
    await store.write("adcode.ads.enabled", false);

    let announced = 0;
    store.onChanged(() => (announced += 1));
    await store.reset();

    expect(announced).toBe(1);
    expect((await store.read())["adcode.ads.enabled"]).toBe(true);
  });
});

describe("current()", () => {
  it("returns defaults before the first load and real values after", async () => {
    await mkdir(dir, { recursive: true });
    const store = createSettingsStore(dir);

    expect(store.current()).toEqual(defaultSettings());

    await store.write("adcode.ads.enabled", false);
    expect(store.current()["adcode.ads.enabled"]).toBe(false);
  });
});
