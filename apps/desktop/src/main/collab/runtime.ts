/**
 * The collaboration runtime: one session, hosted or joined, living in the main process.
 *
 * One session per process, because the workspace root is per-process (the README records why
 * there is no second window) and a session shares exactly one open folder.
 *
 * **Every permission check in this file runs on the host.** That is not defence in depth, it is
 * the only enforcement there is. A guest's ADCode runs on a machine the host does not
 * administer: whatever its UI greys out is a courtesy to a cooperative peer and no obstacle at
 * all to a modified one. So a `doc-update` from a viewer is refused *here*, after parsing and
 * before it reaches a document - and the guest's own greyed-out editor is a nicety on top.
 *
 * The order of checks on every inbound message is fixed and worth stating, because getting it
 * wrong is how authentication gets skipped:
 *
 *   1. Does it parse? (`protocol.ts`, in the transport, before this file sees it.)
 *   2. Is this peer authenticated? An un-helloed peer may send exactly one message: `hello`.
 *   3. Is this peer *allowed* to do this? (`permissions.ts`.)
 *   4. Only then, act.
 */
import { randomBytes } from "node:crypto";
import {
  PROTOCOL_VERSION,
  canAdminister,
  canEdit,
  canRequestCommit,
  canSave,
  capabilitiesOf,
  decodeInvite,
  encodeInvite,
  findParticipant,
  isSupportedProtocol,
  join as joinSession,
  leave as leaveSession,
  newToken,
  setRole as setSessionRole,
  setTerminalWrite as setSessionTerminalWrite,
  startSession,
  type Message,
  type Participant,
  type Presence,
  type Role,
  type SessionState,
} from "@adcode/collab";
import {
  createDocStore,
  decodeUpdate,
  encodeUpdate,
  ORIGIN_LOCAL,
  ORIGIN_REMOTE,
  type DocStore,
} from "./docs.ts";
import { lanTransport } from "./lanTransport.ts";
import type { GuestTransport, HostTransport, PeerLink, TransportFactory } from "./transport.ts";

/** How the renderer sees the session. Mirrored in `shared/api.ts`. */
export interface CollabStatus {
  readonly mode: "off" | "hosting" | "joined" | "connecting";
  readonly participants: readonly Participant[];
  /** Our own id, so the renderer can tell which cursor not to draw. */
  readonly selfId: string | null;
  /** The invite code, host only. `null` for a guest - they have nothing to hand on. */
  readonly invite: string | null;
  /** Every address the session is reachable on, best first. Host only. */
  readonly addresses: readonly string[];
  readonly port: number | null;
  readonly error: string | null;
  /** What *we* may do, so the renderer can disable what would be refused anyway. */
  readonly can: ReturnType<typeof capabilitiesOf> | null;
}

export interface CommitRequest {
  readonly id: string;
  readonly participantId: string;
  readonly participantName: string;
  readonly message: string;
}

export interface CollabEvents {
  readonly onStatus: (status: CollabStatus) => void;
  /** A document changed and the renderer's replica needs the update. Base64. */
  readonly onDocUpdate: (path: string, update: string) => void;
  readonly onPresence: (presence: readonly Presence[]) => void;
  /** A guest wants a commit. The host's UI asks, and answers with `decideCommit`. */
  readonly onCommitRequest: (request: CommitRequest) => void;
  /** Something worth telling the user, in their words. */
  readonly onNotice: (detail: string) => void;
}

export interface StartHostingOptions {
  /** `"lan"` publishes to the network. Never defaulted - see `lanTransport.ts`. */
  readonly bind: "lan" | "loopback";
  readonly port: number;
  readonly displayName: string;
}

export interface CollabRuntime {
  status(): CollabStatus;
  startHosting(root: string | null, options: StartHostingOptions): Promise<CollabStatus>;
  joinWith(code: string, displayName: string): Promise<CollabStatus>;
  leave(): Promise<CollabStatus>;
  /** Open a document in the session, returning its state as base64 for the renderer's replica. */
  openDoc(path: string): Promise<string | null>;
  /** An update from our own renderer. Applied locally and fanned out. */
  pushUpdate(path: string, update: string): void;
  /**
   * The current text of a document, or `null` if it is not loaded.
   *
   * The authoritative copy lives in this process, so this is the answer the disk would get -
   * which is why the save path reads it here rather than asking the renderer.
   */
  docText(path: string): string | null;
  /**
   * A document's full state as base64, without asking the host for anything.
   *
   * Distinct from `openDoc`, which has side effects - it loads from disk on the host and sends
   * `doc-open` on a guest. Its only caller today is `collabSession.test.ts`, which builds a
   * replica the way the renderer does in order to test the update path rather than reaching into
   * the store; it is kept because a side-effect-free read of a document is the obvious companion
   * to `docText` and the alternative is a test that bypasses `pushUpdate` entirely.
   */
  docStateFor(path: string): string | null;
  saveDoc(path: string): Promise<boolean>;
  publishPresence(path: string | null, cursor: Presence["cursor"], selection: Presence["selection"]): void;
  setRole(participantId: string, role: Role): CollabStatus;
  setTerminalWrite(participantId: string, allowed: boolean): CollabStatus;
  requestCommit(message: string): void;
  decideCommit(id: string, approved: boolean, detail: string): void;
  /** For the host, when a file changed outside the session. */
  reloadDoc(path: string): Promise<void>;
  dispose(): Promise<void>;
}

const OFF: CollabStatus = {
  mode: "off",
  participants: [],
  selfId: null,
  invite: null,
  addresses: [],
  port: null,
  error: null,
  can: null,
};

/**
 * How many unparseable frames a peer may send before it is disconnected.
 *
 * Not zero: a version skew or a truncated frame on a flaky network is a mistake, not an attack.
 * Not unbounded either, because absorbing rubbish forever is how a peer keeps a host busy.
 */
const MAX_FAULTS = 8;

export function createCollabRuntime(
  events: CollabEvents,
  transport: TransportFactory = lanTransport,
): CollabRuntime {
  /* ── Session state, one of these at a time ──────────────────────────────── */

  let mode: CollabStatus["mode"] = "off";
  let session: SessionState | null = null;
  let selfId: string | null = null;
  let docs: DocStore | null = null;
  let error: string | null = null;

  // Host only.
  let host: HostTransport | null = null;
  let token: string | null = null;
  let invite: string | null = null;
  let addresses: readonly string[] = [];
  /** Peer link id -> participant id, populated on a successful `hello` and not before. */
  const authenticated = new Map<string, string>();
  const faults = new Map<string, number>();
  const links = new Map<string, PeerLink>();
  const pendingCommits = new Map<string, CommitRequest>();
  let commitCounter = 1;

  // Guest only.
  let guest: GuestTransport | null = null;

  /** Everyone's last known cursor, keyed by participant. */
  const presence = new Map<string, Presence>();

  function selfParticipant(): Participant | null {
    if (session === null || selfId === null) return null;
    return findParticipant(session, selfId);
  }

  function status(): CollabStatus {
    const me = selfParticipant();

    return {
      mode,
      participants: session?.participants ?? [],
      selfId,
      invite,
      addresses,
      port: host?.port ?? null,
      error,
      can: me === null ? null : capabilitiesOf(me),
    };
  }

  function publishStatus(): void {
    events.onStatus(status());
  }

  function publishPresenceList(): void {
    events.onPresence([...presence.values()]);
  }

  /** The roster, to everyone. Sent on every membership or role change. */
  function broadcastRoster(): void {
    if (host === null || session === null) return;
    host.broadcast({ type: "roster", participants: session.participants });
  }

  /* ── Documents ──────────────────────────────────────────────────────────── */

  function attachDocs(store: DocStore): void {
    docs = store;

    store.onUpdate(({ path, update, origin }) => {
      const encoded = encodeUpdate(update);

      // Always to our own renderer, whatever the origin: it holds a replica that has to track
      // this document however it changed - a peer's edit, a disk reload, or our own typing
      // arriving back through the store.
      events.onDocUpdate(path, encoded);

      if (host !== null) {
        /*
         * Fan out to peers, except the one that caused it.
         *
         * Yjs is idempotent so echoing would still converge, but it doubles per-keystroke
         * traffic and makes a genuine loop invisible in a log. The origin tag is how the
         * exception is known - see `ORIGIN_REMOTE` in `docs.ts`.
         */
        const except = typeof origin === "string" && origin.startsWith("peer:")
          ? origin.slice("peer:".length)
          : undefined;

        host.broadcast({ type: "doc-update", path, update: encoded }, except === undefined ? undefined : { except });
        return;
      }

      // A guest sends its own edits up, but must not send back what the host just sent down.
      if (guest !== null && origin !== ORIGIN_REMOTE) {
        guest.send({ type: "doc-update", path, update: encoded });
      }
    });
  }

  /* ── Host: inbound messages ─────────────────────────────────────────────── */

  function noteFault(link: PeerLink, detail: string): void {
    const count = (faults.get(link.id) ?? 0) + 1;
    faults.set(link.id, count);

    if (count > MAX_FAULTS) {
      link.close("Too many messages this version could not read.");
      events.onNotice(`Disconnected a peer that kept sending unreadable data (${detail}).`);
    }
  }

  function participantForLink(link: PeerLink): Participant | null {
    const id = authenticated.get(link.id);
    if (id === undefined || session === null) return null;
    return findParticipant(session, id);
  }

  function handleHello(link: PeerLink, message: Extract<Message, { type: "hello" }>): void {
    if (!isSupportedProtocol(message.protocol)) {
      // Named versions in the message: "it does not work" is not actionable, and a version
      // mismatch is fixed by one of the two people updating.
      link.close(
        `This session speaks protocol ${PROTOCOL_VERSION} and you speak ${message.protocol}. One of you needs a newer ADCode.`,
      );
      return;
    }

    /*
     * The token check, and the only thing standing between the network and this workspace.
     *
     * Compared before any session state is touched, and a failure closes the socket rather
     * than replying with anything a prober could learn from.
     */
    if (token === null || message.token !== token) {
      link.close("That invite code is not valid for this session.");
      return;
    }

    if (session === null) {
      link.close("This session is no longer running.");
      return;
    }

    // Re-authenticating an already-authenticated link would let a peer swap identities
    // mid-session, inheriting whatever role the other identity had been granted.
    if (authenticated.has(link.id)) {
      link.close("Already joined.");
      return;
    }

    const result = joinSession(session, link.id, message.name);
    if (result.participant === null) {
      link.close(result.reason ?? "This session is not accepting anyone else.");
      return;
    }

    session = result.state;
    authenticated.set(link.id, result.participant.id);

    link.send({
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      you: result.participant.id,
      participants: session.participants,
    });

    broadcastRoster();
    publishStatus();
    events.onNotice(`${result.participant.name} joined the session.`);
  }

  async function handleHostMessage(link: PeerLink, message: Message): Promise<void> {
    if (message.type === "hello") {
      handleHello(link, message);
      return;
    }

    /*
     * Step 2 of the fixed order: an un-helloed peer may send nothing but `hello`.
     *
     * Without this, every branch below would have to remember to check - and the one that
     * forgot would be an unauthenticated write to the host's disk.
     */
    const participant = participantForLink(link);
    if (participant === null) {
      link.close("Say hello first.");
      return;
    }

    switch (message.type) {
      case "doc-open": {
        const store = docs;
        if (store === null) return;

        const doc = await store.open(message.path);
        if (doc === null) {
          // Refused without saying which of "outside the folder" or "does not exist" it was -
          // the same reasoning as `resolveRequestPath` returning a single `null`.
          link.send({ type: "error", detail: `Cannot open ${message.path} in this session.` });
          return;
        }

        const state = store.stateOf(message.path);
        if (state !== null) {
          link.send({ type: "doc-state", path: message.path, update: encodeUpdate(state) });
        }
        return;
      }

      case "doc-update": {
        if (!canEdit(participant)) {
          link.send({ type: "error", detail: "You have view-only access to this session." });
          return;
        }

        const store = docs;
        const bytes = decodeUpdate(message.update);
        if (store === null || bytes === null) return;

        // Opened first: a peer may legitimately send an update for a document the host has not
        // loaded, and dropping it would lose their keystrokes.
        await store.open(message.path);

        // Tagged with the peer so the fan-out leaves them out. A fixed `ORIGIN_REMOTE` is right
        // for a guest, which has one peer, but loses the identity a host needs.
        if (!store.applyRemote(message.path, bytes, `peer:${link.id}`)) {
          noteFault(link, "an update that was not a valid document change");
        }
        return;
      }

      case "doc-save": {
        if (!canSave(participant)) {
          link.send({ type: "error", detail: "You have view-only access to this session." });
          return;
        }

        const saved = (await docs?.save(message.path)) ?? false;
        if (saved) {
          // Everyone, not just the saver: another guest's dirty marker for this file should
          // clear too, because the file on disk now matches what they are looking at.
          host?.broadcast({ type: "doc-saved", path: message.path });
        }
        return;
      }

      case "presence": {
        presence.set(participant.id, {
          participantId: participant.id,
          path: message.path,
          cursor: message.cursor,
          selection: message.selection,
        });

        // Relayed with the sender's id stamped by the host, and deliberately ignoring whatever
        // `message.participantId` said: a peer that could name someone else here could move
        // their cursor.
        host?.broadcast(
          {
            type: "presence",
            participantId: participant.id,
            path: message.path,
            cursor: message.cursor,
            selection: message.selection,
          },
          { except: link.id },
        );
        publishPresenceList();
        return;
      }

      case "commit-request": {
        if (!canRequestCommit(participant)) {
          link.send({ type: "error", detail: "You have view-only access to this session." });
          return;
        }

        const id = `commit-${commitCounter++}`;
        const request: CommitRequest = {
          id,
          participantId: participant.id,
          participantName: participant.name,
          message: message.message,
        };

        pendingCommits.set(id, request);
        events.onCommitRequest(request);
        return;
      }

      case "set-role":
      case "set-terminal-write": {
        /*
         * Administration arrives from the host's own UI, never from a socket.
         *
         * A peer sending this is either a bug or an attempt, and the check is the same either
         * way: `canAdminister` is true only for the host, and the host is not a peer.
         */
        if (!canAdminister(participant)) {
          link.send({ type: "error", detail: "Only the host can change what people may do." });
        }
        return;
      }

      case "terminal-input":
        // Parsed and permission-checked, but not yet wired to a shell. Refused with the honest
        // reason rather than silently dropped, so a guest is not left typing into nothing.
        link.send({ type: "error", detail: "Shared terminals are not available in this build." });
        return;

      default:
        return;
    }
  }

  /* ── Guest: inbound messages ────────────────────────────────────────────── */

  function handleGuestMessage(message: Message): void {
    switch (message.type) {
      case "welcome": {
        selfId = message.you;
        session = { participants: [...message.participants], joinCount: message.participants.length };
        mode = "joined";
        error = null;
        publishStatus();
        return;
      }

      case "refused": {
        error = message.reason;
        mode = "off";
        events.onNotice(message.reason);
        publishStatus();
        return;
      }

      case "roster": {
        session = { participants: [...message.participants], joinCount: message.participants.length };
        publishStatus();
        return;
      }

      case "doc-state":
      case "doc-update": {
        const store = docs;
        const bytes = decodeUpdate(message.update);
        if (store === null || bytes === null) return;

        void store.open(message.path).then(() => {
          store.applyRemote(message.path, bytes);
        });
        return;
      }

      case "doc-saved": {
        events.onNotice(`${message.path} was saved on the host.`);
        return;
      }

      case "presence": {
        // Attributed by the host, which stamped the id on relay. An unattributed presence
        // message cannot be drawn against anyone, so it is dropped rather than guessed at.
        if (message.participantId === null) return;

        presence.set(message.participantId, {
          participantId: message.participantId,
          path: message.path,
          cursor: message.cursor,
          selection: message.selection,
        });
        publishPresenceList();
        return;
      }

      case "commit-decision": {
        events.onNotice(
          message.approved
            ? `The host committed your changes${message.detail === "" ? "" : ` (${message.detail})`}.`
            : `The host declined the commit${message.detail === "" ? "" : `: ${message.detail}`}.`,
        );
        return;
      }

      case "error": {
        events.onNotice(message.detail);
        return;
      }

      default:
        return;
    }
  }

  /* ── Teardown ───────────────────────────────────────────────────────────── */

  async function teardown(): Promise<void> {
    await host?.close();
    await guest?.close();
    docs?.dispose();

    host = null;
    guest = null;
    docs = null;
    session = null;
    selfId = null;
    token = null;
    invite = null;
    addresses = [];
    mode = "off";

    authenticated.clear();
    faults.clear();
    links.clear();
    presence.clear();
    pendingCommits.clear();
  }

  /* ── The runtime ────────────────────────────────────────────────────────── */

  const runtime: CollabRuntime = {
    status,

    async startHosting(root, options) {
      if (root === null) {
        error = "Open a folder before sharing it - there is nothing to share yet.";
        return status();
      }

      await teardown();
      error = null;

      try {
        // `randomBytes`, never `Math.random`. The token is the only credential in the session.
        token = newToken(new Uint8Array(randomBytes(32)));

        host = await transport.startHost(options, {
          onPeerConnected: (link) => {
            links.set(link.id, link);
          },
          onMessage: (link, message) => {
            void handleHostMessage(link, message).catch((cause: unknown) => {
              // A failure handling one message must never take the session down for everyone.
              events.onNotice(`A message from a peer could not be handled: ${String(cause)}`);
            });
          },
          onPeerClosed: (link) => {
            const participantId = authenticated.get(link.id);
            authenticated.delete(link.id);
            faults.delete(link.id);
            links.delete(link.id);

            if (participantId !== null && participantId !== undefined && session !== null) {
              const leaving = findParticipant(session, participantId);
              session = leaveSession(session, participantId);
              presence.delete(participantId);

              if (leaving !== null) events.onNotice(`${leaving.name} left the session.`);
              broadcastRoster();
              publishStatus();
              publishPresenceList();
            }
          },
          onPeerFault: (link, detail) => noteFault(link, detail),
          onError: (detail) => {
            error = detail;
            publishStatus();
          },
        });

        selfId = "host";
        session = startSession(selfId, options.displayName);
        attachDocs(createDocStore({ root, ownsDisk: true }));

        addresses = host.addresses;
        // The first address is the best guess; the UI lets the user pick another and re-encode.
        invite = encodeInvite({
          host: addresses[0] ?? "127.0.0.1",
          port: host.port,
          token,
          label: options.displayName,
        });

        mode = "hosting";
      } catch (cause: unknown) {
        await teardown();
        error = `Could not start the session: ${cause instanceof Error ? cause.message : String(cause)}`;
      }

      publishStatus();
      return status();
    },

    async joinWith(code, displayName) {
      await teardown();

      const decoded = decodeInvite(code);
      if (decoded === null) {
        error = "That does not look like an ADCode invite code.";
        publishStatus();
        return status();
      }

      mode = "connecting";
      error = null;
      publishStatus();

      try {
        guest = await transport.connectGuest(
          { host: decoded.host, port: decoded.port },
          {
            onMessage: handleGuestMessage,
            onClosed: (detail) => {
              if (mode !== "off") {
                events.onNotice(detail === null ? "The session ended." : `The session ended: ${detail}`);
              }
              void teardown().then(publishStatus);
            },
            onError: (detail) => {
              error = detail;
              publishStatus();
            },
          },
        );

        // A guest's store never reads the local disk: the same relative path on their machine
        // is a different file. See `docs.ts`.
        attachDocs(createDocStore({ root: "", ownsDisk: false }));

        guest.send({ type: "hello", protocol: PROTOCOL_VERSION, token: decoded.token, name: displayName });
      } catch (cause: unknown) {
        await teardown();
        error = cause instanceof Error ? cause.message : String(cause);
      }

      publishStatus();
      return status();
    },

    async leave() {
      await teardown();
      publishStatus();
      return status();
    },

    async openDoc(path) {
      const store = docs;
      if (store === null) return null;

      const doc = await store.open(path);
      if (doc === null) return null;

      // A guest asks the host for the real content; the local document starts empty and fills
      // in when `doc-state` arrives.
      if (guest !== null) guest.send({ type: "doc-open", path });

      const state = store.stateOf(path);
      return state === null ? null : encodeUpdate(state);
    },

    pushUpdate(path, update) {
      const store = docs;
      const bytes = decodeUpdate(update);
      if (store === null || bytes === null) return;

      // Tagged as local, so the fan-out treats it as ours and sends it to everyone. A guest
      // checks for `ORIGIN_REMOTE` specifically before sending upward, so any other tag - this
      // one included - is forwarded to the host.
      store.applyRemote(path, bytes, ORIGIN_LOCAL);
    },

    docText(path) {
      return docs?.text(path) ?? null;
    },

    docStateFor(path) {
      const state = docs?.stateOf(path) ?? null;
      return state === null ? null : encodeUpdate(state);
    },

    async saveDoc(path) {
      if (host !== null) {
        const saved = (await docs?.save(path)) ?? false;
        if (saved) host.broadcast({ type: "doc-saved", path });
        return saved;
      }

      // A guest cannot write the host's disk directly - it asks, and the host's permission
      // check decides.
      guest?.send({ type: "doc-save", path });
      return false;
    },

    publishPresence(path, cursor, selection) {
      if (selfId !== null) {
        presence.set(selfId, { participantId: selfId, path, cursor, selection });
      }

      // The host stamps its own id, since nobody downstream will. A guest sends `null` and lets
      // the host attribute it.
      if (host !== null) {
        host.broadcast({ type: "presence", participantId: selfId, path, cursor, selection });
      } else {
        guest?.send({ type: "presence", participantId: null, path, cursor, selection });
      }
    },

    setRole(participantId, role) {
      if (session === null || host === null) return status();

      session = setSessionRole(session, participantId, role);
      broadcastRoster();
      publishStatus();
      return status();
    },

    setTerminalWrite(participantId, allowed) {
      if (session === null || host === null) return status();

      session = setSessionTerminalWrite(session, participantId, allowed);
      broadcastRoster();
      publishStatus();
      return status();
    },

    requestCommit(message) {
      guest?.send({ type: "commit-request", message });
    },

    decideCommit(id, approved, detail) {
      const request = pendingCommits.get(id);
      if (request === null || request === undefined || host === null) return;

      pendingCommits.delete(id);

      // Back to the one peer who asked, found by their participant id rather than kept as a
      // link reference - the socket may have gone away while the host was deciding.
      for (const [linkId, participantId] of authenticated) {
        if (participantId === request.participantId) {
          host.send(linkId, { type: "commit-decision", approved, detail });
          return;
        }
      }
    },

    async reloadDoc(path) {
      await docs?.reload(path);
    },

    async dispose() {
      await teardown();
    },
  };

  return runtime;
}
