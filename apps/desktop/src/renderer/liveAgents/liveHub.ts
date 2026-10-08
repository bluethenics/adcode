/**
 * A renderer-side bus between whatever runs agents and the room that shows them.
 *
 * Team in the terminal runs inside the terminal panel, which knows nothing about the chat;
 * the room lives in the chat, which knows nothing about terminal panes. Both know this.
 */
import type { LiveAgentIdentity, LiveRoomEvent, LiveSignal } from "./liveRoomModel.ts";

export type LiveHubMessage =
  | { readonly kind: "event"; readonly identity: LiveAgentIdentity; readonly event: LiveRoomEvent }
  | { readonly kind: "waiting"; readonly identity: LiveAgentIdentity; readonly step: string }
  | { readonly kind: "settle"; readonly group: string }
  | { readonly kind: "signal"; readonly signal: Omit<LiveSignal, "id"> };

const listeners = new Set<(message: LiveHubMessage) => void>();

export function publishLive(message: LiveHubMessage): void {
  for (const listener of listeners) listener(message);
}

export function subscribeLive(listener: (message: LiveHubMessage) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
