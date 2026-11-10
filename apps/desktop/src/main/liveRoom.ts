/**
 * The live room the person is in, for the assistant.
 *
 * The window talks to the room through `community.ts`; every answer the relay gives passes
 * through `rememberRoom` on its way back, so the main process always holds the newest
 * snapshot of the room this person has joined - without a second connection or a poll of
 * its own. That snapshot becomes context for every turn (`shared/roomContext.ts`), and the
 * `adcode_room` tool lets the assistant read it afresh and write back: say what it finished,
 * pin a decision to a file, add, claim or finish a plan step.
 *
 * The tool can do only what the member's role allows - the relay decides, exactly as it does
 * for the buttons - and never anything a person in the room could not do by hand.
 */
import type { ArtifactRoomSnapshot } from "@adcode/collab";
import type { ToolRunResult } from "@adcode/ai";
import { roomContextText, roomIsJoined } from "../shared/roomContext.ts";

/** A snapshot older than this says nothing reliable about who is online. */
const FRESH_MS = 3 * 60_000;

interface ActiveRoom { readonly id: string; readonly key: string | null; snapshot: ArtifactRoomSnapshot; at: number }
let active: ActiveRoom | null = null;

export type RoomRequest = (id: string, key: string | null, action: Record<string, unknown> | null) => Promise<ArtifactRoomSnapshot>;
let roomRequest: RoomRequest | null = null;
/** `community.ts` supplies the one way to reach the relay; set once at startup. */
export function setRoomRequest(request: RoomRequest): void { roomRequest = request; }

function isSnapshot(value: unknown): value is ArtifactRoomSnapshot {
  const room = value as Partial<ArtifactRoomSnapshot> | null;
  return typeof room === "object" && room !== null && typeof room.selfId === "string" && Array.isArray(room.members) && Array.isArray(room.messages);
}

/** Called with every room answer. Keeps the one the person is a present member of. */
export function rememberRoom(id: string, key: string | null, value: unknown): void {
  if (!isSnapshot(value)) return;
  if (roomIsJoined(value)) active = { id, key, snapshot: value, at: Date.now() };
  else if (active?.id === id) active = null;
}

export function forgetRoom(id: string): void {
  if (active?.id === id) active = null;
}

/** The room as context lines, or "" when the person is in none (or it has gone quiet). */
export function liveRoomContext(now = Date.now()): string {
  if (active === null || now - active.at > FRESH_MS) return "";
  return roomContextText(active.snapshot);
}

export const liveRoomJoined = (): boolean => active !== null && Date.now() - active.at <= FRESH_MS;

const ok = (content: string): ToolRunResult => ({ content, isError: false });
const fail = (content: string): ToolRunResult => ({ content, isError: true });
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export async function runRoomTool(input: Record<string, unknown>, signal: AbortSignal): Promise<ToolRunResult> {
  if (signal.aborted) return fail("Cancelled.");
  if (active === null || roomRequest === null) return fail("The user is not in a live room. They can start or join one from the Live button beside the chat, or from Artifacts.");
  const room = active;
  const send = async (action: Record<string, unknown> | null): Promise<ArtifactRoomSnapshot> => {
    const snapshot = await roomRequest!(room.id, room.key, action);
    rememberRoom(room.id, room.key, snapshot);
    return snapshot;
  };
  const action = text(input["action"]);
  try {
    if (action === "read") return ok(roomContextText(await send(null)));
    if (action === "say") {
      const message = text(input["text"]);
      if (message.length < 1 || message.length > 1000) return fail("say needs text of 1-1000 characters.");
      await send({ action: "post", text: message, kind: "agent" });
      return ok("Posted to the room as the user's assistant.");
    }
    if (action === "note") {
      const path = text(input["path"]);
      const message = text(input["text"]);
      if (path === "" || message.length < 3) return fail("note needs path (the project file it is about) and text.");
      await send({ action: "note", operation: "add", path, text: message });
      return ok(`Pinned a shared note to ${path}.`);
    }
    if (action === "plan_add") {
      const title = text(input["title"]);
      if (title.length < 3 || title.length > 200) return fail("plan_add needs a title of 3-200 characters.");
      const paths = Array.isArray(input["paths"]) ? input["paths"].filter((path): path is string => typeof path === "string").slice(0, 20) : [];
      await send({ action: "plan", operation: "add", title, ...(paths.length > 0 ? { paths } : {}), ...(input["mine"] === true ? { ownerUid: room.snapshot.selfId } : {}) });
      return ok(`Added "${title}" to the shared plan.`);
    }
    if (action === "plan_claim" || action === "plan_done" || action === "plan_blocked") {
      const wanted = text(input["step"]).toLowerCase();
      const fresh = await send(null);
      const step = fresh.plan.find((item) => item.id === wanted) ?? fresh.plan.find((item) => item.title.toLowerCase().includes(wanted));
      if (wanted === "" || step === undefined) return fail(`No plan step matches "${text(input["step"])}". Steps: ${fresh.plan.map((item) => item.title).join("; ") || "none"}.`);
      if (action === "plan_claim") {
        if (step.ownerUid !== null && step.ownerUid !== fresh.selfId) return fail(`"${step.title}" belongs to a teammate. Ask the user before taking it.`);
        await send({ action: "plan", operation: "move", id: step.id, status: "doing", ownerUid: fresh.selfId });
        return ok(`Claimed "${step.title}" for the user; it is marked doing.`);
      }
      await send({ action: "plan", operation: "move", id: step.id, status: action === "plan_done" ? "done" : "blocked" });
      return ok(`Marked "${step.title}" ${action === "plan_done" ? "done" : "blocked"}.`);
    }
  } catch (error) {
    return fail(`The room refused: ${(error instanceof Error ? error.message : String(error)).replace(/^\[\d{3}\]\s*/, "")}`);
  }
  return fail("Unknown room action. Use read, say, note, plan_add, plan_claim, plan_done or plan_blocked.");
}
