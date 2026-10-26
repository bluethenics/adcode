import { copyFile, mkdtemp, readFile, rename, rm, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  const crossDevice = async (): Promise<void> => { throw Object.assign(new Error("cross-device link"), { code: "EXDEV" }); };

  it("saves model changes when a virtualized Windows folder rejects rename", async () => {
    const store = createSettingsStore(dir, { replace: crossDevice });
    await store.write("adcode.ai.model", "tagflow-code-27b");
    expect((await createSettingsStore(dir).read())["adcode.ai.model"]).toBe("tagflow-code-27b");
    await expect(readFile(`${settingsFile()}.tmp`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains the previous validated settings if the fallback copy is interrupted", async () => {
    await createSettingsStore(dir).write("adcode.ai.model", "previous-model");
    const announced = vi.fn();
    const store = createSettingsStore(dir, { replace: crossDevice, copy: async (_from, to) => {
      await writeFile(to, '{"version":', "utf8");
      throw new Error("copy interrupted");
    } });
    store.onChanged(announced);
    await expect(store.write("adcode.ai.model", "new-model")).rejects.toThrow("copy interrupted");
    expect(store.current()["adcode.ai.model"]).toBe("previous-model");
    expect(announced).not.toHaveBeenCalled();
    expect((await createSettingsStore(dir).read())["adcode.ai.model"]).toBe("previous-model");
  });

  it("recovers the prior state after an interrupted copy, then safely saves another change", async () => {
    const store = createSettingsStore(dir, { replace: crossDevice });
    await store.write("adcode.ai.model", "previous-model");
    await store.write("adcode.ai.model", "new-model");
    await writeFile(settingsFile(), "{truncated", "utf8");
    const backup = `${settingsFile()}.bak`;
    const previousTime = new Date("2000-01-01T00:00:00Z");
    await utimes(backup, previousTime, previousTime);
    const restarted = createSettingsStore(dir, { replace: crossDevice });
    expect((await restarted.read())["adcode.ai.model"]).toBe("previous-model");
    await restarted.write("adcode.ads.frequency", "light");
    const recovered = await createSettingsStore(dir).read();
    expect(recovered["adcode.ai.model"]).toBe("previous-model");
    expect(recovered["adcode.ads.frequency"]).toBe("light");
    // Recovering from a backup must not rewrite that only intact file before copying.
    expect((await stat(backup)).mtimeMs).toBe(previousTime.getTime());
  });

  it("keeps its intact backup across successive failed copies in the same process", async () => {
    await createSettingsStore(dir).write("adcode.ai.model", "previous-model");
    const store = createSettingsStore(dir, { replace: crossDevice, copy: async (_from, to) => {
      await writeFile(to, "{truncated", "utf8");
      throw new Error("copy interrupted");
    } });
    await expect(store.write("adcode.ai.model", "first-attempt")).rejects.toThrow();
    const backup = `${settingsFile()}.bak`;
    const previousTime = new Date("2000-01-01T00:00:00Z");
    await utimes(backup, previousTime, previousTime);
    await expect(store.write("adcode.ai.model", "second-attempt")).rejects.toThrow();
    expect((await stat(backup)).mtimeMs).toBe(previousTime.getTime());
    expect((await createSettingsStore(dir).read())["adcode.ai.model"]).toBe("previous-model");
  });

  it("does not fall back to a non-atomic copy for ordinary write failures", async () => {
    const copy = vi.fn(copyFile);
    const store = createSettingsStore(dir, { replace: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); }, copy });
    await expect(store.write("adcode.ai.model", "new-model")).rejects.toThrow("permission denied");
    expect(copy).not.toHaveBeenCalled();
    expect(store.current()["adcode.ai.model"]).toBe(defaultSettings()["adcode.ai.model"]);
  });

  it("serializes changes so concurrent settings writes cannot overwrite each other", async () => {
    let release: (() => void) | undefined;
    const firstCopyStarted = new Promise<void>(resolve => { release = resolve; });
    let unblock: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const replace = vi.fn(async (from: string, to: string) => {
      if (replace.mock.calls.length === 1) { release!(); await blocked; }
      await rename(from, to);
    });
    const store = createSettingsStore(dir, { replace });
    const first = store.write("adcode.ai.model", "chosen-model");
    await firstCopyStarted;
    const second = store.write("adcode.ads.frequency", "light");
    expect(replace).toHaveBeenCalledTimes(1);
    unblock!(); await Promise.all([first, second]);
    const values = await createSettingsStore(dir).read();
    expect(values["adcode.ai.model"]).toBe("chosen-model");
    expect(values["adcode.ads.frequency"]).toBe("light");
  });

  it("survives a restart", async () => {
    const first = createSettingsStore(dir);
    await first.write("adcode.editing.minimap", false);
    await first.write("adcode.ads.frequency", "light");

    const second = createSettingsStore(dir);
    const values = await second.read();

    expect(values["adcode.editing.minimap"]).toBe(false);
    expect(values["adcode.ads.frequency"]).toBe("light");
    expect(values["adcode.editing.stickyScroll"]).toBe(false);
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
    expect(values["adcode.editing.stickyScroll"]).toBe(false);
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

    expect(values["adcode.editing.minimap"]).toBe(false);
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
