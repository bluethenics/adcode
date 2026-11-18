/**
 * Team chats: a shared project's session, mirrored into an ordinary ADCode chat.
 *
 * The project service holds every member's messages and the AI's answers; each member's computer
 * keeps a local chat for the session, so a team chat opens in the real chat - the same composer,
 * model, tools and build cards as a solo chat - and the AI, when asked, builds right there.
 * This file is the pure part: merging the service's messages into the local chat without
 * duplicating the ones this computer wrote, and telling a message for the AI from one for the
 * people. No I/O.
 */
import type { ChatMessage } from "@adcode/ai";

export interface SharedMessage {
  readonly seq: number;
  readonly authorId: string;
  readonly authorName: string;
  readonly kind: "member" | "assistant" | "error";
  readonly text: string;
  readonly at: number;
}

/** The local chat's id for a shared session: stable, so every visit opens the same chat. */
export function teamChatId(sessionId: string): string {
  return `team-${sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 58)}`;
}

/** A message meant for the AI: the AI switch is on, or it starts with @ai. The mention is dropped. */
export function aiRequest(text: string, switchOn: boolean): { readonly ask: boolean; readonly text: string } {
  const mention = /^\s*@ai\b[\s,:]*/i;
  if (mention.test(text)) return { ask: true, text: text.replace(mention, "").trim() || text.trim() };
  return { ask: switchOn, text: text.trim() };
}

/**
 * The local chat with the service's messages merged in, in order.
 *
 * A message this computer already holds is recognised rather than added twice: its own member
 * message (sent from here, so recorded before the service numbered it) by its text, and the AI
 * answer it produced here by being the first unnumbered answer. Everything else is appended with
 * its author. Error notices from the service are not chat messages and are left out.
 */
export function mergeTeamMessages(local: readonly ChatMessage[], remote: readonly SharedMessage[], selfId: string, nameOf: (uid: string) => string): { readonly messages: ChatMessage[]; readonly added: number; readonly fromOthers: number } {
  const messages = [...local];
  const known = new Set(messages.flatMap((message) => message.seq === undefined ? [] : [message.seq]));
  let added = 0, fromOthers = 0;
  for (const item of [...remote].sort((a, b) => a.seq - b.seq)) {
    if (item.kind === "error" || known.has(item.seq)) continue;
    known.add(item.seq);
    const mine = item.authorId === selfId;
    if (mine && item.kind === "member") {
      const index = messages.findIndex((message) => message.role === "user" && message.seq === undefined && message.text.replace(/\n?\[Attached: [^\n]*\]\s*$/, "").trim() === item.text.trim());
      if (index >= 0) { messages[index] = { ...messages[index]!, seq: item.seq, author: { id: item.authorId, name: item.authorName, self: true } }; continue; }
    }
    if (mine && item.kind === "assistant") {
      const index = messages.findIndex((message) => message.role === "assistant" && message.seq === undefined);
      if (index >= 0) { messages[index] = { ...messages[index]!, seq: item.seq, author: { id: item.authorId, name: nameOf(item.authorId), self: true } }; continue; }
    }
    messages.push(item.kind === "member"
      ? { role: "user", text: item.text, at: item.at, seq: item.seq, author: { id: item.authorId, name: item.authorName, self: mine } }
      : { role: "assistant", text: item.text, at: item.at, seq: item.seq, author: { id: item.authorId, name: nameOf(item.authorId), self: mine } });
    added += 1;
    if (!mine) fromOthers += 1;
  }
  return { messages, added, fromOthers };
}
