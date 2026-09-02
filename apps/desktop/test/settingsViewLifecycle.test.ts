import { describe, expect, it } from "vitest";
import { createSettingsTargetLifecycle } from "../src/renderer/settings/settingsView.ts";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Settings target lifecycle", () => {
  it("reapplies a cold-open target after delayed settings replace its rows", async () => {
    const read = deferred<void>();
    let highlighted: string | null = null;
    let focused: string | null = null;
    const lifecycle = createSettingsTargetLifecycle({
      render() {
        highlighted = null;
        focused = null;
      },
      reveal(settingId) {
        highlighted = settingId;
        focused = settingId;
      },
    });

    lifecycle.shown(() => read.promise);
    lifecycle.openAt("adcode.editing.minimap");
    expect(highlighted).toBe("adcode.editing.minimap");
    expect(focused).toBe("adcode.editing.minimap");

    read.resolve();
    await read.promise;
    await Promise.resolve();

    expect(highlighted).toBe("adcode.editing.minimap");
    expect(focused).toBe("adcode.editing.minimap");
  });
});
