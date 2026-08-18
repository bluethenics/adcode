/**
 * A real session between two peers, over real sockets.
 *
 * This is the test that decides whether the feature works. Everything under
 * `packages/collab` is a pure function and tested as one, but "two people type on the same
 * line and both end up with the same text" is not a property of any single function - it is a
 * property of a host, a guest, a WebSocket, two Yjs documents and a permission check, all
 * behaving at once. So both runtimes run for real here, bound to loopback, talking over the
 * same transport the shipped app uses.
 *
 * The one thing faked is the network's location: `bind: "loopback"` instead of `"lan"`, so the
 * suite does not open a port to the outside world on whatever machine happens to run it. The
 * code path either side of the bind is identical.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { PROTOCOL_VERSION, decodeInvite, encodeInvite } from "@adcode/collab";
import { createCollabRuntime, type CollabRuntime, type CollabStatus, type CommitRequest } from "../src/main/collab/runtime.ts";

/** The one file every test in here shares. */
const FILE = "notes.txt";

/** Poll until a condition holds. Message passing is asynchronous; a fixed sleep is a flake. */
async function until(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for: ${label}`);
}

interface Harness {
  readonly runtime: CollabRuntime;
  readonly notices: string[];
  readonly commitRequests: CommitRequest[];
  readonly docUpdates: { path: string; update: string }[];
  status: CollabStatus | null;
}

function harness(): Harness {
  const state: Harness = {
    runtime: undefined as unknown as CollabRuntime,
    notices: [],
    commitRequests: [],
    docUpdates: [],
    status: null,
  };

  const runtime = createCollabRuntime({
    onStatus: (status) => {
      state.status = status;
    },
    onDocUpdate: (path, update) => {
      state.docUpdates.push({ path, update });
    },
    onPresence: () => {},
    onCommitRequest: (request) => {
      state.commitRequests.push(request);
    },
    onNotice: (detail) => {
      state.notices.push(detail);
    },
  });

  return { ...state, runtime };
}

describe("a live collaboration session", { timeout: 30_000 }, () => {
  let root = "";
  let host: Harness;
  let guest: Harness;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "adcode-collab-"));
    await writeFile(join(root, FILE), "hello", "utf8");

    host = harness();
    guest = harness();
  });

  afterEach(async () => {
    await guest.runtime.dispose();
    await host.runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });

  async function share(): Promise<string> {
    const status = await host.runtime.startHosting(root, {
      bind: "loopback",
      port: 0,
      displayName: "Ada",
    });

    expect(status.error).toBeNull();
    expect(status.mode).toBe("hosting");
    expect(status.invite).not.toBeNull();

    return status.invite as string;
  }

  async function joinAs(name: string, code: string): Promise<void> {
    await guest.runtime.joinWith(code, name);
    await until(() => guest.runtime.status().mode === "joined", "the guest to be welcomed");
  }

  it("refuses to host with no folder open", async () => {
    const status = await host.runtime.startHosting(null, {
      bind: "loopback",
      port: 0,
      displayName: "Ada",
    });

    expect(status.mode).toBe("off");
    expect(status.error).toMatch(/Open a folder/);
  });

  it("hands out an invite that decodes to the bound port", async () => {
    const code = await share();
    const decoded = decodeInvite(code);

    expect(decoded).not.toBeNull();
    expect(decoded?.port).toBe(host.runtime.status().port);
    expect(decoded?.host).toBe("127.0.0.1");
    expect(decoded?.label).toBe("Ada");
    // The token is a real secret, not a placeholder.
    expect((decoded?.token ?? "").length).toBeGreaterThanOrEqual(32);
  });

  it("admits a guest with the right code and lists them in both rosters", async () => {
    const code = await share();
    await joinAs("Grace", code);

    await until(() => host.runtime.status().participants.length === 2, "the host roster to grow");

    const hostRoster = host.runtime.status().participants;
    expect(hostRoster.map((p) => p.name)).toEqual(["Ada", "Grace"]);
    expect(hostRoster[0]?.role).toBe("host");
    expect(hostRoster[1]?.role).toBe("editor");

    const guestRoster = guest.runtime.status().participants;
    expect(guestRoster.map((p) => p.name)).toEqual(["Ada", "Grace"]);

    // Distinguishable cursors, agreed without either side negotiating.
    expect(hostRoster[0]?.colour).not.toBe(hostRoster[1]?.colour);
    expect(guestRoster[1]?.colour).toBe(hostRoster[1]?.colour);
  });

  it("never grants a joining guest the terminal", async () => {
    const code = await share();
    await joinAs("Grace", code);
    await until(() => host.runtime.status().participants.length === 2, "the roster");

    expect(host.runtime.status().participants[1]?.terminalWrite).toBe(false);
    expect(guest.runtime.status().can?.writeTerminal).toBe(false);
  });

  it("turns a wrong token away without admitting them", async () => {
    const code = await share();
    const real = decodeInvite(code);
    const forged = encodeInvite({ ...(real as NonNullable<typeof real>), token: "not-the-token" });

    await guest.runtime.joinWith(forged, "Intruder");
    await until(() => guest.notices.length > 0, "a refusal to reach the guest");

    expect(guest.notices.join(" ")).toMatch(/invite code is not valid/i);
    expect(guest.runtime.status().mode).not.toBe("joined");
    // And crucially, the host's session is untouched.
    expect(host.runtime.status().participants).toHaveLength(1);
  });

  it("refuses a garbled invite code before opening a socket", async () => {
    await share();
    const status = await guest.runtime.joinWith("this is not a code", "Grace");

    expect(status.mode).toBe("off");
    expect(status.error).toMatch(/invite code/i);
  });

  it("sends the host's file content to a guest that opens it", async () => {
    const code = await share();
    await joinAs("Grace", code);

    await guest.runtime.openDoc(FILE);
    await until(() => guest.runtime.status().mode === "joined", "the session");

    // The guest's own disk is never read - it starts empty and fills from `doc-state`.
    await until(() => guestText() === "hello", "the host's content to arrive at the guest");
    expect(guest.docUpdates.some((u) => u.path === FILE)).toBe(true);
  });

  it("converges when both peers edit the same line at once", async () => {
    /*
     * The property the whole CRDT dependency exists for.
     *
     * Both peers insert at offset 0 of the same document with no coordination, which is the
     * case a last-write-wins scheme silently loses one half of. Yjs is expected to keep both
     * insertions and order them consistently - so the assertion is not on the exact string,
     * which is arbitrary, but on the two peers agreeing and neither edit being dropped.
     */
    const code = await share();
    await joinAs("Grace", code);

    await host.runtime.openDoc(FILE);
    await guest.runtime.openDoc(FILE);
    await until(() => guest.docUpdates.length > 0, "the guest to receive the document");

    expect(hostText()).toBe("hello");
    await until(() => guestText() === "hello", "the guest to match the host");

    // Simultaneous, from both ends, with no await between them.
    editHost("HOST-");
    editGuest("GUEST-");

    await until(() => hostText() === guestText(), "the two peers to converge", 8000);

    const converged = hostText();
    expect(converged).toContain("HOST-");
    expect(converged).toContain("GUEST-");
    expect(converged).toContain("hello");
    expect(guestText()).toBe(converged);
  });

  it("writes the host's disk when a guest saves, and tells everyone", async () => {
    const code = await share();
    await joinAs("Grace", code);

    await host.runtime.openDoc(FILE);
    await guest.runtime.openDoc(FILE);
    await until(() => guestText() === "hello", "the guest to receive the document");

    editGuest("saved-");
    await until(() => hostText().includes("saved-"), "the edit to reach the host");

    await guest.runtime.saveDoc(FILE);
    await until(
      () => guest.notices.some((n) => n.includes(FILE)),
      "the host to confirm the save",
    );

    const onDisk = await readFile(join(root, FILE), "utf8");
    expect(onDisk).toContain("saved-");
    expect(onDisk).toBe(hostText());
  });

  it("stops a viewer from changing the document, on the host", async () => {
    /*
     * Enforcement is host-side, and this test is written to prove exactly that.
     *
     * The guest's runtime is not asked to behave: it is told to send an update, and the update
     * is sent. What stops it is the host's own permission check, which is the only enforcement
     * that means anything - a guest's ADCode runs on a machine the host does not administer.
     */
    const code = await share();
    await joinAs("Grace", code);
    await until(() => host.runtime.status().participants.length === 2, "the roster");

    await host.runtime.openDoc(FILE);
    await guest.runtime.openDoc(FILE);
    await until(() => guestText() === "hello", "the guest to receive the document");

    const guestId = host.runtime.status().participants[1]?.id as string;
    host.runtime.setRole(guestId, "viewer");
    await until(
      () => guest.runtime.status().participants[1]?.role === "viewer",
      "the demotion to reach the guest",
    );

    editGuest("REFUSED-");

    // Give the message every chance to be applied before asserting it was not.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(hostText()).toBe("hello");
    expect(await readFile(join(root, FILE), "utf8")).toBe("hello");
    expect(guest.notices.join(" ")).toMatch(/view-only/i);
  });

  it("revokes the terminal grant when the host demotes someone", async () => {
    const code = await share();
    await joinAs("Grace", code);
    await until(() => host.runtime.status().participants.length === 2, "the roster");

    const guestId = host.runtime.status().participants[1]?.id as string;

    host.runtime.setTerminalWrite(guestId, true);
    expect(host.runtime.status().participants[1]?.terminalWrite).toBe(true);

    host.runtime.setRole(guestId, "viewer");
    expect(host.runtime.status().participants[1]?.terminalWrite).toBe(false);
  });

  it("carries a commit request to the host and a decision back", async () => {
    const code = await share();
    await joinAs("Grace", code);
    await until(() => host.runtime.status().participants.length === 2, "the roster");

    guest.runtime.requestCommit("Add a note");
    await until(() => host.commitRequests.length === 1, "the request to reach the host");

    const request = host.commitRequests[0] as CommitRequest;
    expect(request.message).toBe("Add a note");
    expect(request.participantName).toBe("Grace");

    host.runtime.decideCommit(request.id, true, "abc1234");
    await until(
      () => guest.notices.some((n) => n.includes("abc1234")),
      "the decision to reach the guest",
    );
  });

  it("drops a guest from the roster when they disconnect", async () => {
    const code = await share();
    await joinAs("Grace", code);
    await until(() => host.runtime.status().participants.length === 2, "the roster to grow");

    await guest.runtime.leave();
    await until(
      () => host.runtime.status().participants.length === 1,
      "the roster to shrink",
    );

    expect(host.notices.join(" ")).toMatch(/Grace left/);
  });

  it("refuses a peer speaking a different protocol version", async () => {
    const code = await share();
    const decoded = decodeInvite(code) as NonNullable<ReturnType<typeof decodeInvite>>;

    // Hand-rolled rather than through the runtime, because the runtime always sends the
    // version it was compiled with - and the case being tested is the other build.
    const { WebSocket } = await import("ws");
    const socket = new WebSocket(`ws://127.0.0.1:${decoded.port}/`);
    const seen: string[] = [];

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.send(
          JSON.stringify({
            type: "hello",
            protocol: PROTOCOL_VERSION + 99,
            token: decoded.token,
            name: "Old build",
          }),
        );
      });
      socket.on("message", (data: Buffer) => {
        seen.push(data.toString("utf8"));
        resolve();
      });
      socket.once("error", reject);
      setTimeout(() => reject(new Error("no reply")), 5000);
    });

    socket.close();

    // Names both versions: "it does not work" is not actionable, and the fix is one of the two
    // people updating.
    expect(seen.join(" ")).toMatch(/protocol/i);
    expect(seen.join(" ")).toMatch(/newer ADCode/i);
    expect(host.runtime.status().participants).toHaveLength(1);
  });

  it("refuses a plain HTTP request to the session port without describing the workspace", async () => {
    const code = await share();
    const decoded = decodeInvite(code) as NonNullable<ReturnType<typeof decodeInvite>>;

    const response = await fetch(`http://127.0.0.1:${decoded.port}/`);
    const body = await response.text();

    // The port is reachable from the network, so it gets probed. It must volunteer nothing.
    expect(response.status).toBe(426);
    expect(body).not.toMatch(/adcode-collab|notes\.txt|Ada/i);
  });

  /* ── Reading and editing, the way the renderer does ──────────────────────── */

  function hostText(): string {
    return host.runtime.docText(FILE) ?? "";
  }

  function guestText(): string {
    return guest.runtime.docText(FILE) ?? "";
  }

  /**
   * Make a local edit exactly as the renderer would.
   *
   * Not by reaching into the runtime's document. The renderer holds its own Yjs replica bound
   * to Monaco, edits *that*, and ships the resulting update through `pushUpdate` - so a test
   * that mutated the runtime's copy directly would be exercising a path the app never takes,
   * and would not notice if `pushUpdate` were broken.
   *
   * The replica here is built from the runtime's current state, edited, and the update it emits
   * is handed back. That is the whole contract between renderer and main.
   */
  function editAs(peer: Harness, text: string): void {
    const state = peer.runtime.docStateFor(FILE);
    if (state === null) throw new Error(`${FILE} is not open on this peer`);

    const replica = new Y.Doc();
    // `docStateFor` returns base64, because that is what crosses the IPC bridge. Handing the
    // string straight to `Y.applyUpdate` leaves the replica empty rather than failing loudly,
    // which made this helper look like it worked - the edit still merged, because Yjs merges
    // unrelated documents happily, so the test passed while testing the wrong thing.
    Y.applyUpdate(replica, new Uint8Array(Buffer.from(state, "base64")));

    // The replica really is a copy of what the peer has, so an edit below is an edit *from*
    // the current text rather than an insert into an empty document.
    expect(replica.getText("text").toString()).toBe(peer.runtime.docText(FILE));

    let produced: Uint8Array | null = null;
    replica.on("update", (update: Uint8Array) => {
      produced = update;
    });

    replica.getText("text").insert(0, text);
    replica.destroy();

    if (produced === null) throw new Error("the replica produced no update");
    peer.runtime.pushUpdate(FILE, Buffer.from(produced).toString("base64"));
  }

  function editHost(text: string): void {
    editAs(host, text);
  }

  function editGuest(text: string): void {
    editAs(guest, text);
  }
});
