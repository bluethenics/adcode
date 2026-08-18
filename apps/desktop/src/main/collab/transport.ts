/**
 * The transport seam.
 *
 * Everything above this file - the roster, the documents, the permission checks, the editor
 * decorations - talks in `Message` values and knows nothing about how they travel. That is the
 * whole point of the interface: LAN today, a relay later, and the swap touches this directory
 * and nothing else.
 *
 * The shape is deliberately asymmetric, because the roles are. A host **accepts** an unknown
 * number of peers and has to be able to address them individually (to refuse one, or to send a
 * document only to whoever asked for it). A guest has exactly **one** link, to the host, and no
 * concept of another peer at all - guests never talk to each other, which is what keeps the
 * permission checks in one place. Modelling both with a single symmetric `Channel` would mean
 * inventing a peer list on the guest side that always has one entry.
 *
 * Why this lives in `main/` and not in `packages/collab`: it needs a real socket. The pure
 * package holds the parts that can be tested without one, and a `ws` import would end that.
 */
import type { Message } from "@adcode/collab";

/** One connected peer, from the host's side. */
export interface PeerLink {
  /** Assigned by the transport on accept. Becomes the `ParticipantId` once the peer says hello. */
  readonly id: string;
  /** The peer's address, for the roster and for the log. Never used as a credential. */
  readonly address: string;
  send(message: Message): void;
  /**
   * Close the link.
   *
   * `reason` is sent as a `refused` message first where the socket is still writable, because
   * a guest whose connection simply drops has nothing to show the user but "disconnected",
   * and "the session is full" or "that code is out of date" are worth saying.
   */
  close(reason?: string): void;
}

export interface HostTransportEvents {
  readonly onPeerConnected: (link: PeerLink) => void;
  /** A parsed, well-formed message. Malformed frames never reach here - see `parse`. */
  readonly onMessage: (link: PeerLink, message: Message) => void;
  /** Fires exactly once per peer, whether it left cleanly or the socket broke. */
  readonly onPeerClosed: (link: PeerLink) => void;
  /**
   * A frame that could not be parsed, or a socket-level fault.
   *
   * Separate from `onMessage` so the host can count and disconnect a peer that keeps sending
   * rubbish, rather than silently absorbing it forever.
   */
  readonly onPeerFault: (link: PeerLink, detail: string) => void;
  readonly onError: (detail: string) => void;
}

export interface HostTransport {
  readonly port: number;
  /**
   * The addresses a guest could actually use to reach this machine.
   *
   * Plural and ordered best-first: a laptop has a Wi-Fi address, an Ethernet address, and
   * several virtual ones from Docker, WSL and VPN adapters. Guessing wrong means handing out
   * an invite code that cannot possibly work, so the caller shows the list and the user picks.
   */
  readonly addresses: readonly string[];
  broadcast(message: Message, options?: { readonly except?: string }): void;
  send(peerId: string, message: Message): void;
  close(): Promise<void>;
}

export interface GuestTransportEvents {
  readonly onMessage: (message: Message) => void;
  readonly onClosed: (detail: string | null) => void;
  readonly onError: (detail: string) => void;
}

export interface GuestTransport {
  send(message: Message): void;
  close(): Promise<void>;
}

export interface HostTransportOptions {
  /**
   * Which interface to bind.
   *
   * `"lan"` binds `0.0.0.0` and is the only setting that makes collaboration possible, since
   * a guest is on another machine. It is also the inversion of the decision `liveServer.ts`
   * documents at length - that server binds loopback precisely so a project folder is not
   * published to the network - so it is never a default and the caller has to ask for it.
   *
   * `"loopback"` exists for tests and for a user sharing between two windows on one machine.
   */
  readonly bind: "lan" | "loopback";
  /**
   * A fixed port, or 0 to let the OS choose.
   *
   * A default of 0 would mean a different port every session, and the invite code carries the
   * port so that is survivable - but a stable port is friendlier for a firewall prompt the
   * user has already answered once.
   */
  readonly port: number;
}

/**
 * The two factories a transport implementation provides.
 *
 * A relay implementation supplies this same pair, and `collabRuntime` takes it as a
 * parameter - so adding one is a new file plus a settings row, with no change above.
 */
export interface TransportFactory {
  readonly startHost: (
    options: HostTransportOptions,
    events: HostTransportEvents,
  ) => Promise<HostTransport>;
  readonly connectGuest: (
    target: { readonly host: string; readonly port: number },
    events: GuestTransportEvents,
  ) => Promise<GuestTransport>;
}
