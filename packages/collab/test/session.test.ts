/**
 * The roster state machine, and the permission predicates that read it.
 *
 * The interesting cases are the transitions, not the steady states. A host demoting someone
 * who holds the terminal grant, a guest reconnecting after a dropped socket, a colour being
 * reused after someone leaves - each of those is a sequence, and each has a wrong answer that
 * looks perfectly reasonable in isolation.
 */
import { describe, expect, it } from "vitest";
import {
  CURSOR_COLOURS,
  DEFAULT_GUEST_ROLE,
  canAdminister,
  canCommitDirectly,
  canEdit,
  canReadTerminal,
  canRequestCommit,
  canSave,
  canWriteTerminal,
  capabilitiesOf,
  colourForIndex,
  findParticipant,
  hostOf,
  join,
  labelInkFor,
  leave,
  rename,
  sanitiseName,
  selectionTintFor,
  setRole,
  setTerminalWrite,
  startSession,
  summarise,
} from "@adcode/collab";
import type { Participant } from "@adcode/collab";

function withTwoGuests() {
  const start = startSession("host", "Ada");
  const first = join(start, "p2", "Grace");
  const second = join(first.state, "p3", "Alan");
  return second.state;
}

function guest(state: ReturnType<typeof withTwoGuests>, id: string): Participant {
  const found = findParticipant(state, id);
  if (found === null) throw new Error(`no participant ${id}`);
  return found;
}

describe("startSession", () => {
  it("creates exactly one host, holding the first colour", () => {
    const state = startSession("h", "Ada");
    expect(state.participants).toHaveLength(1);
    expect(state.participants[0]).toMatchObject({
      id: "h",
      name: "Ada",
      role: "host",
      colour: colourForIndex(0),
      // The host may already type in their own terminal - it is their machine.
      terminalWrite: true,
    });
    expect(hostOf(state)?.id).toBe("h");
  });
});

describe("join", () => {
  it("admits a guest as an editor, without the terminal", () => {
    const { state, participant, reason } = join(startSession("h", "Ada"), "p2", "Grace");

    expect(reason).toBeNull();
    expect(participant).toMatchObject({ role: DEFAULT_GUEST_ROLE, terminalWrite: false });
    expect(state.participants).toHaveLength(2);
  });

  it("never grants the terminal on join, whatever the role", () => {
    // The one capability that is code execution on someone else's machine. It exists only
    // through a deliberate act, so no join path may produce it.
    const { participant } = join(startSession("h", "Ada"), "p2", "Grace");
    expect(participant?.terminalWrite).toBe(false);
    expect(canWriteTerminal(participant as Participant)).toBe(false);
  });

  it("treats a repeated id as a reconnect, preserving the assigned role", () => {
    // A dropped socket must not create a second row with a second cursor, and must not hand
    // back the editing rights a host had deliberately taken away.
    const state = setRole(withTwoGuests(), "p2", "viewer");
    const again = join(state, "p2", "Grace");

    expect(again.state.participants).toHaveLength(3);
    expect(again.participant?.role).toBe("viewer");
    expect(again.state.joinCount).toBe(state.joinCount);
  });

  it("refuses with a reason once the session is full", () => {
    let state = startSession("h", "Ada");
    for (let i = 0; i < 31; i++) state = join(state, `p${i}`, `Guest ${i}`).state;

    expect(state.participants).toHaveLength(32);

    const overflow = join(state, "one-too-many", "Nope");
    expect(overflow.participant).toBeNull();
    // A reason, not an exception: this is driven by a message from the network, and the
    // caller has to send something back.
    expect(overflow.reason).toMatch(/full/);
    expect(overflow.state).toBe(state);
  });
});

describe("colours", () => {
  it("keeps a colour attached to a person after someone else leaves", () => {
    /*
     * The bug this defends. If colours were indexed by `participants.length`, a guest
     * leaving would free their colour and the next joiner would inherit it - so within a
     * minute two different people would both have been "the purple cursor", which makes
     * "look at my cursor" ambiguous exactly when it is being said.
     */
    const state = withTwoGuests();
    const alan = guest(state, "p3").colour;

    const afterLeaving = leave(state, "p2");
    const rejoined = join(afterLeaving, "p4", "Katherine");

    expect(guest(rejoined.state, "p3").colour).toBe(alan);
    expect(rejoined.participant?.colour).not.toBe(guest(state, "p2").colour);
  });

  it("wraps rather than running out", () => {
    // A ninth participant repeating a colour is a cosmetic collision. No colour at all is a
    // missing cursor, which is worse.
    expect(colourForIndex(CURSOR_COLOURS.length)).toBe(CURSOR_COLOURS[0]);
    expect(colourForIndex(CURSOR_COLOURS.length * 3 + 2)).toBe(CURSOR_COLOURS[2]);
  });

  it("survives a nonsense index from a corrupted roster", () => {
    for (const index of [-1, -50, 1.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(CURSOR_COLOURS).toContain(colourForIndex(index));
    }
  });

  it("never uses the accent blue or the danger red", () => {
    // A remote cursor in `--accent` reads as your own caret; one in `--danger` reads as an
    // error. Both are already spoken for.
    expect(CURSOR_COLOURS).not.toContain("#007aff");
    expect(CURSOR_COLOURS).not.toContain("#0a84ff");
    expect(CURSOR_COLOURS).not.toContain("#ff3b30");
  });

  it("picks readable label ink for every colour in the palette", () => {
    // Yellow needs black text where purple needs white, and computing it means adding a
    // colour above cannot leave an unreadable label behind.
    expect(labelInkFor("#ffcc00")).toBe("#000000");
    expect(labelInkFor("#af52de")).toBe("#ffffff");

    for (const colour of CURSOR_COLOURS) {
      expect(["#000000", "#ffffff"]).toContain(labelInkFor(colour));
    }
  });

  it("falls back to white ink on an unparseable colour", () => {
    expect(labelInkFor("not a colour")).toBe("#ffffff");
    expect(labelInkFor("")).toBe("#ffffff");
  });

  it("tints a colour for selection without leaving it unparseable", () => {
    expect(selectionTintFor("#34c759")).toBe("#34c75933");
    expect(selectionTintFor("#34c759", 0)).toBe("#34c75900");
    expect(selectionTintFor("#34c759", 255)).toBe("#34c759ff");
    // Out-of-range alpha is clamped, never wrapped into a two-character overflow.
    expect(selectionTintFor("#34c759", 999)).toBe("#34c759ff");
    expect(selectionTintFor("#34c759", -5)).toBe("#34c75900");
    expect(selectionTintFor("garbage")).toBe("garbage");
  });
});

describe("setRole", () => {
  it("promotes and demotes a guest", () => {
    const state = setRole(withTwoGuests(), "p2", "viewer");
    expect(guest(state, "p2").role).toBe("viewer");
    expect(canEdit(guest(state, "p2"))).toBe(false);
  });

  it("revokes the terminal when demoting to viewer", () => {
    /*
     * The transition that has a plausible wrong answer. Leaving the grant set on someone who
     * may no longer edit produces a viewer who can still run commands on the host's machine -
     * which is the exact opposite of what demoting them meant.
     */
    const granted = setTerminalWrite(withTwoGuests(), "p2", true);
    expect(canWriteTerminal(guest(granted, "p2"))).toBe(true);

    const demoted = setRole(granted, "p2", "viewer");
    expect(guest(demoted, "p2").terminalWrite).toBe(false);
    expect(canWriteTerminal(guest(demoted, "p2"))).toBe(false);
  });

  it("never reassigns the host's own role", () => {
    const state = setRole(withTwoGuests(), "host", "viewer");
    expect(hostOf(state)?.id).toBe("host");
    expect(guest(state, "host").role).toBe("host");
  });

  it("refuses to create a second host", () => {
    // `host` is not an assignable role. A session has exactly one, and it is the machine
    // that owns the disk.
    const state = setRole(withTwoGuests(), "p2", "host" as never);
    expect(state.participants.filter((p) => p.role === "host")).toHaveLength(1);
    expect(guest(state, "p2").role).toBe(DEFAULT_GUEST_ROLE);
  });

  it("ignores an unknown participant", () => {
    const state = withTwoGuests();
    expect(setRole(state, "nobody", "viewer")).toBe(state);
  });
});

describe("setTerminalWrite", () => {
  it("grants and revokes for one guest only", () => {
    const state = setTerminalWrite(withTwoGuests(), "p2", true);
    expect(canWriteTerminal(guest(state, "p2"))).toBe(true);
    expect(canWriteTerminal(guest(state, "p3"))).toBe(false);

    const revoked = setTerminalWrite(state, "p2", false);
    expect(canWriteTerminal(guest(revoked, "p2"))).toBe(false);
  });

  it("will not grant it to a viewer", () => {
    // Would create a participant who may execute commands but not type in a file.
    const viewer = setRole(withTwoGuests(), "p2", "viewer");
    const attempted = setTerminalWrite(viewer, "p2", true);
    expect(guest(attempted, "p2").terminalWrite).toBe(false);
  });
});

describe("leave", () => {
  it("removes a guest", () => {
    const state = leave(withTwoGuests(), "p2");
    expect(findParticipant(state, "p2")).toBeNull();
    expect(state.participants).toHaveLength(2);
  });

  it("will not remove the host", () => {
    // A session with no host has no disk to edit and no authority to enforce anything.
    const state = withTwoGuests();
    expect(leave(state, "host")).toBe(state);
  });

  it("treats an unknown id as nothing to do", () => {
    const state = withTwoGuests();
    expect(leave(state, "nobody")).toBe(state);
  });
});

describe("sanitiseName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitiseName("Grace Hopper")).toBe("Grace Hopper");
  });

  it("strips control characters and bidi overrides", () => {
    // Untrusted text drawn next to a cursor. Control characters break layout, and a
    // bidirectional override can reorder the text around it to misrepresent a roster row.
    expect(sanitiseName("Gr ace")).toBe("Grace");
    expect(sanitiseName("‮evil")).toBe("evil");
    expect(sanitiseName("a⁦b⁩c")).toBe("abc");
  });

  it("never yields an empty label", () => {
    // A nameless cursor floating in the editor is worse than a placeholder.
    expect(sanitiseName("")).toBe("Guest");
    expect(sanitiseName("   ")).toBe("Guest");
    expect(sanitiseName(" ")).toBe("Guest");
  });

  it("caps the length", () => {
    expect(sanitiseName("x".repeat(500))).toHaveLength(64);
  });

  it("is applied on join and on rename", () => {
    const joined = join(startSession("h", "Ada"), "p2", "‮Grace ");
    expect(joined.participant?.name).toBe("Grace");

    const renamed = rename(joined.state, "p2", "  Katherine  ");
    expect(findParticipant(renamed, "p2")?.name).toBe("Katherine");
  });
});

describe("permissions", () => {
  const state = setTerminalWrite(withTwoGuests(), "p2", true);
  const host = guest(state, "host");
  const editor = guest(state, "p3");
  const trusted = guest(state, "p2");
  const viewer = guest(setRole(state, "p3", "viewer"), "p3");

  it("lets an editor edit and save but not commit", () => {
    expect(canEdit(editor)).toBe(true);
    expect(canSave(editor)).toBe(true);
    expect(canCommitDirectly(editor)).toBe(false);
    // They can ask. The host approves, and the commit runs under the host's identity.
    expect(canRequestCommit(editor)).toBe(true);
  });

  it("lets a viewer read and follow, and nothing else", () => {
    expect(canEdit(viewer)).toBe(false);
    expect(canSave(viewer)).toBe(false);
    expect(canRequestCommit(viewer)).toBe(false);
    expect(canWriteTerminal(viewer)).toBe(false);
    // Watching output is not executing anything.
    expect(canReadTerminal(viewer)).toBe(true);
  });

  it("reserves administration and direct commits for the host", () => {
    expect(canAdminister(host)).toBe(true);
    expect(canCommitDirectly(host)).toBe(true);
    expect(canAdminister(editor)).toBe(false);
    expect(canAdminister(trusted)).toBe(false);
  });

  it("requires both the grant and an editing role for the terminal", () => {
    expect(canWriteTerminal(trusted)).toBe(true);

    // A grant left behind on a demoted participant must not be enough on its own. `setRole`
    // clears it too - these are two independent guards on the same door, and neither is
    // redundant because they fail in different directions.
    const stale: Participant = { ...trusted, role: "viewer" };
    expect(canWriteTerminal(stale)).toBe(false);
  });

  it("reports a full capability set that matches the predicates", () => {
    for (const participant of [host, editor, trusted, viewer]) {
      expect(capabilitiesOf(participant)).toEqual({
        read: true,
        edit: canEdit(participant),
        save: canSave(participant),
        commitDirectly: canCommitDirectly(participant),
        requestCommit: canRequestCommit(participant),
        readTerminal: true,
        writeTerminal: canWriteTerminal(participant),
        administer: canAdminister(participant),
      });
    }
  });
});

describe("summarise", () => {
  it("says nobody has joined when the host is alone", () => {
    expect(summarise(startSession("h", "Ada"))).toMatch(/nobody/);
  });

  it("counts guests, not participants, and gets the plural right", () => {
    const one = join(startSession("h", "Ada"), "p2", "Grace").state;
    expect(summarise(one)).toBe("Sharing · 1 person");
    expect(summarise(withTwoGuests())).toBe("Sharing · 2 people");
  });
});
