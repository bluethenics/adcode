/**
 * The LAN transport: a WebSocket server on the host, one client per guest.
 *
 * WebSocket rather than raw TCP because it brings message framing with it. A stream socket
 * would mean writing a length-prefixed framer, and `packages/lsp` exists in this repository
 * largely because *that* is the code which breaks - byte framing across chunk boundaries is
 * genuinely hard and there is no reason to write it twice.
 *
 * **This file binds beyond loopback, and that inverts a decision made deliberately elsewhere.**
 * `liveServer.ts` binds `127.0.0.1` and says publishing a beginner's project folder to every
 * device on their network "is not a default anybody asked for". That reasoning is still correct;
 * collaboration is the case where the user *did* ask. So the inversion is paid for:
 *
 * - `bind: "lan"` is never a default. The caller passes it, and only in response to the user
 *   starting a session.
 * - Every message must carry the session token, checked by the layer above before any state is
 *   touched. An unauthenticated socket is closed.
 * - The addresses actually bound are reported back so the UI can show what was published.
 *
 * What this does not do is encrypt. On a LAN the frames are plaintext, so anyone positioned to
 * capture packets sees the invite token and then the file contents. On a home network that is
 * the trust boundary the preview server already assumes; on a shared or public network it is
 * not, and the UI has to say so rather than imply otherwise. TLS with a self-signed
 * certificate is the fix and it is not built.
 */
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { LIMITS, parse, serialise, type Message } from "@adcode/collab";
import type {
  GuestTransport,
  GuestTransportEvents,
  HostTransport,
  HostTransportEvents,
  HostTransportOptions,
  PeerLink,
  TransportFactory,
} from "./transport.ts";

/**
 * How long a peer has to complete its handshake.
 *
 * A socket that connects and says nothing costs a file descriptor and a slot in the peer map.
 * The layer above closes a peer that fails to authenticate; this is the backstop for one that
 * never speaks at all.
 */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Frames past this are dropped by `ws` itself, before any allocation this process controls. */
const MAX_FRAME_BYTES = LIMITS.frame;

let nextPeerNumber = 1;

/**
 * The addresses on this machine a guest could reach, best first.
 *
 * Ordered rather than filtered, because "which of these is the one my friend can use" is not
 * answerable from inside this process - a Docker bridge and a real Wi-Fi adapter look alike
 * from here. What is knowable is that virtual adapters are usually wrong, so they sort last and
 * the UI's default pick is the one most likely to work.
 */
export function localAddresses(): readonly string[] {
  const found: { address: string; rank: number }[] = [];

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // IPv4 only: the invite codec does not carry an IPv6 literal, and half-supporting one
      // would produce codes that decode and then fail to connect.
      if (entry.family !== "IPv4" || entry.internal) continue;

      const lower = name.toLowerCase();
      const virtual = /docker|veth|vmnet|vboxnet|wsl|hyper-v|vethernet|tailscale|zt|utun|tun|tap|loopback/.test(
        lower,
      );

      // A private-range address is the realistic case for two machines on one network; a
      // public one on a local adapter is more often a VPN or a carrier NAT.
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);

      found.push({ address: entry.address, rank: (virtual ? 2 : 0) + (priv ? 0 : 1) });
    }
  }

  return found.sort((a, b) => a.rank - b.rank).map((entry) => entry.address);
}

function textOf(data: RawData): string | null {
  // `ws` hands over a Buffer, an ArrayBuffer, or an array of Buffers depending on how the
  // frame arrived. Anything that is not decodable text is not one of our messages.
  try {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    return null;
  } catch {
    return null;
  }
}

export async function startLanHost(
  options: HostTransportOptions,
  events: HostTransportEvents,
): Promise<HostTransport> {
  const address = options.bind === "lan" ? "0.0.0.0" : "127.0.0.1";

  const http: Server = createServer((_request, response) => {
    /*
     * A plain HTTP request to this port gets a flat refusal.
     *
     * This port is reachable from the network, so it will be probed - by a browser the user
     * pointed at it by mistake, and by whatever else scans the subnet. Answering with anything
     * about the workspace, the session, or even the product would be volunteering information
     * to an unauthenticated caller.
     */
    response.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
    response.end("This port speaks WebSocket only.");
  });

  const server = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES });
  const links = new Map<string, { link: PeerLink; socket: WebSocket }>();

  server.on("connection", (socket, request) => {
    const id = `peer-${nextPeerNumber++}`;
    const remote = request.socket.remoteAddress ?? "unknown";

    const link: PeerLink = {
      id,
      address: remote,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(serialise(message));
      },
      close(reason) {
        if (reason !== undefined && socket.readyState === WebSocket.OPEN) {
          socket.send(serialise({ type: "refused", reason }));
        }
        // 1000, not 1008: the reason has already been sent as a message the guest can read,
        // and a close code is not something a user ever sees.
        socket.close(1000);
      },
    };

    links.set(id, { link, socket });

    // A socket that connects and never speaks costs a descriptor and a map slot. The layer
    // above evicts an unauthenticated peer; this catches one that says nothing at all.
    const handshake = setTimeout(() => {
      if (links.has(id)) link.close("No handshake.");
    }, HANDSHAKE_TIMEOUT_MS);
    handshake.unref?.();

    events.onPeerConnected(link);

    socket.on("message", (data) => {
      const raw = textOf(data);
      if (raw === null) {
        events.onPeerFault(link, "A frame that was not text.");
        return;
      }

      const message = parse(raw);
      if (message === null) {
        // Reported, never absorbed. A peer sending rubbish repeatedly is a peer to disconnect,
        // and that decision needs to be counted somewhere.
        events.onPeerFault(link, "A frame that did not parse.");
        return;
      }

      if (message.type === "hello") clearTimeout(handshake);
      events.onMessage(link, message);
    });

    socket.on("close", () => {
      clearTimeout(handshake);
      // Guarded so `onPeerClosed` fires exactly once: `close` and `error` can both arrive.
      if (links.delete(id)) events.onPeerClosed(link);
    });

    socket.on("error", (error: Error) => {
      events.onPeerFault(link, error.message);
    });
  });

  server.on("error", (error: Error) => events.onError(error.message));

  const port = await new Promise<number>((settle, fail) => {
    http.once("error", fail);
    http.listen(options.port, address, () => {
      const bound = http.address();
      if (bound === null || typeof bound === "string") {
        fail(new Error("The session server started but reported no address."));
        return;
      }
      settle(bound.port);
    });
  });

  return {
    port,
    addresses: options.bind === "lan" ? localAddresses() : ["127.0.0.1"],

    broadcast(message, broadcastOptions) {
      const frame = serialise(message);
      for (const [id, entry] of links) {
        if (id === broadcastOptions?.except) continue;
        if (entry.socket.readyState === WebSocket.OPEN) entry.socket.send(frame);
      }
    },

    send(peerId, message) {
      const entry = links.get(peerId);
      if (entry !== undefined && entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(serialise(message));
      }
    },

    async close() {
      for (const entry of links.values()) entry.socket.close(1000);
      links.clear();

      await new Promise<void>((done) => {
        server.close(() => done());
      });
      await new Promise<void>((done) => {
        http.close(() => done());
        http.closeAllConnections?.();
      });
    },
  };
}

export async function connectLanGuest(
  target: { readonly host: string; readonly port: number },
  events: GuestTransportEvents,
): Promise<GuestTransport> {
  /*
   * The URL is built from parts that were validated by `decodeInvite`, never from a pasted
   * string. That matters: a host field carrying `evil.com/path?` or credentials would change
   * where this connects, and by the time it reaches here it has already been checked against
   * an allow-list of address shapes.
   */
  const socket = new WebSocket(`ws://${target.host}:${target.port}/`, {
    maxPayload: MAX_FRAME_BYTES,
    handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
  });

  await new Promise<void>((settle, fail) => {
    const onOpen = (): void => {
      socket.off("error", onError);
      settle();
    };
    const onError = (error: Error): void => {
      socket.off("open", onOpen);
      // The message a user sees when a code does not work, so it carries the address it tried.
      fail(new Error(`Could not reach ${target.host}:${target.port} - ${error.message}`));
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
  });

  socket.on("message", (data) => {
    const raw = textOf(data);
    if (raw === null) {
      events.onError("The host sent a frame that was not text.");
      return;
    }

    const message = parse(raw);
    if (message === null) {
      events.onError("The host sent a frame this version could not read.");
      return;
    }

    events.onMessage(message);
  });

  let closedDetail: string | null = null;
  socket.on("error", (error: Error) => {
    closedDetail = error.message;
    events.onError(error.message);
  });
  socket.on("close", () => events.onClosed(closedDetail));

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(serialise(message));
    },
    async close() {
      socket.close(1000);
    },
  };
}

/** The LAN implementation of the seam in `transport.ts`. */
export const lanTransport: TransportFactory = {
  startHost: startLanHost,
  connectGuest: connectLanGuest,
};
