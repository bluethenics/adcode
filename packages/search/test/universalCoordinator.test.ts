import { describe, expect, it, vi } from "vitest";
import {
  createUniversalSearchCoordinator,
  type UniversalSearchItem,
  type UniversalSearchSnapshot,
} from "../src/universal.ts";

const feature = (title: string): UniversalSearchItem => ({
  id: `feature:${title}`,
  kind: "feature",
  title,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("universal search coordination", () => {
  it("publishes local results before asynchronous providers finish", async () => {
    const files = deferred<readonly UniversalSearchItem[]>();
    const snapshots: UniversalSearchSnapshot[] = [];
    const coordinator = createUniversalSearchCoordinator({
      local: () => [feature("Assistant")],
      providers: [{ source: "file", search: () => files.promise }],
      publish: (snapshot) => snapshots.push(snapshot),
    });

    const settled = coordinator.search("assist");
    expect(snapshots[0]?.items.map((item) => item.id)).toEqual(["feature:Assistant"]);
    expect(snapshots[0]?.pending).toEqual(["file"]);

    files.resolve([{ id: "file:assistant.ts", kind: "file", title: "assistant.ts" }]);
    await settled;
    expect(snapshots.at(-1)?.items.map((item) => item.id)).toContain("file:assistant.ts");
  });

  it("does not request symbols below two trimmed characters", async () => {
    const symbols = vi.fn(async () => []);
    const coordinator = createUniversalSearchCoordinator({
      local: () => [],
      providers: [{ source: "symbol", minimumQueryLength: 2, search: symbols }],
      publish: () => undefined,
    });

    await coordinator.search(" a ");
    expect(symbols).not.toHaveBeenCalled();
    await coordinator.search(" ab ");
    expect(symbols).toHaveBeenCalledOnce();
  });

  it("ignores stale results from an older generation", async () => {
    const oldFiles = deferred<readonly UniversalSearchItem[]>();
    const newFiles = deferred<readonly UniversalSearchItem[]>();
    const snapshots: UniversalSearchSnapshot[] = [];
    const coordinator = createUniversalSearchCoordinator({
      local: (query) => [feature(query)],
      providers: [
        {
          source: "file",
          search: (query) => (query === "old" ? oldFiles.promise : newFiles.promise),
        },
      ],
      publish: (snapshot) => snapshots.push(snapshot),
    });

    const oldSettled = coordinator.search("old");
    const newSettled = coordinator.search("new");
    newFiles.resolve([{ id: "file:new", kind: "file", title: "new" }]);
    await newSettled;
    oldFiles.resolve([{ id: "file:old", kind: "file", title: "old" }]);
    await oldSettled;

    const afterNew = snapshots.slice(snapshots.findIndex((snapshot) => snapshot.query === "new"));
    expect(afterNew.every((snapshot) => snapshot.query === "new")).toBe(true);
    expect(afterNew.flatMap((snapshot) => snapshot.items).map((item) => item.id)).not.toContain(
      "file:old",
    );
  });

  it("keeps successful sources when one provider fails", async () => {
    const snapshots: UniversalSearchSnapshot[] = [];
    const coordinator = createUniversalSearchCoordinator({
      local: () => [feature("Team")],
      providers: [
        { source: "file", search: async () => { throw new Error("disk offline"); } },
        {
          source: "symbol",
          minimumQueryLength: 2,
          search: async () => [{ id: "symbol:Team", kind: "symbol", title: "Team" }],
        },
      ],
      publish: (snapshot) => snapshots.push(snapshot),
    });

    await coordinator.search("team");
    expect(snapshots.at(-1)?.items.map((item) => item.id)).toContain("symbol:Team");
    expect(snapshots.at(-1)?.failures).toEqual([
      { source: "file", message: "File results are unavailable right now." },
    ]);
  });

  it("publishes nothing after close", async () => {
    const files = deferred<readonly UniversalSearchItem[]>();
    const publish = vi.fn();
    const coordinator = createUniversalSearchCoordinator({
      local: () => [],
      providers: [{ source: "file", search: () => files.promise }],
      publish,
    });

    const settled = coordinator.search("later");
    coordinator.close();
    const callsAtClose = publish.mock.calls.length;
    files.resolve([{ id: "file:late", kind: "file", title: "late" }]);
    await settled;

    expect(publish).toHaveBeenCalledTimes(callsAtClose);
  });
});
