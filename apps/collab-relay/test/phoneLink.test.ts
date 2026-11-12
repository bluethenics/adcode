import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}));

/** Just enough of a Workers WebSocket: an attachment and a list of what it was sent. */
class FakeSocket {
  attachment: unknown = null;
  sent: unknown[] = [];
  closed: { code: number; reason: string } | null = null;
  serializeAttachment(value: unknown): void { this.attachment = structuredClone(value); }
  deserializeAttachment(): unknown { return this.attachment; }
  send(raw: string): void { this.sent.push(JSON.parse(raw)); }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  accept(): void {}
}

const pairs: FakeSocket[] = [];
(globalThis as Record<string, unknown>)["WebSocketPair"] = class {
  0 = new FakeSocket();
  1 = new FakeSocket();
  constructor() { pairs.push(this[1]); }
};
// Node's Response refuses status 101; the room only needs it carried through.
const RealResponse = globalThis.Response;
(globalThis as Record<string, unknown>)["Response"] = class extends RealResponse {
  constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    super(body, init?.status === 101 ? { ...init, status: 200 } : init);
  }
  static override json(data: unknown, init?: ResponseInit) { return RealResponse.json(data, init); }
};

const { PhoneLink, phoneLinkRoute } = await import("../src/phoneLink.ts");

function room() {
  const sockets: { socket: FakeSocket; tags: string[] }[] = [];
  const ctx = {
    acceptWebSocket(socket: FakeSocket, tags: string[]) { sockets.push({ socket, tags }); },
    getWebSockets(tag?: string) { return sockets.filter((one) => one.socket.closed === null && (tag === undefined || one.tags.includes(tag))).map((one) => one.socket); },
  };
  const link = new PhoneLink(ctx as never, {} as never);
  const join = async (role: "host" | "phone", query = ""): Promise<FakeSocket> => {
    await link.fetch(new Request(`https://phone.link/${role}${query}`, { headers: { upgrade: "websocket" } }));
    return pairs[pairs.length - 1]!;
  };
  return { link, join };
}

describe("phone link room", () => {
  it("tells each side who is on the other, and forwards only between them", async () => {
    const { link, join } = room();
    const host = await join("host", "?device=laptop-1&name=Studio%20laptop&platform=darwin");
    const phone = await join("phone", "?name=iPhone");
    expect(phone.sent.at(-1)).toMatchObject({ type: "hosts", hosts: [{ id: "laptop-1", name: "Studio laptop", platform: "darwin" }] });
    expect(host.sent.at(-1)).toMatchObject({ type: "phones", phones: [{ label: "iPhone" }] });
    const phoneId = (phone.attachment as { id: string }).id;

    link.webSocketMessage(phone as never, JSON.stringify({ type: "to", host: "laptop-1", data: '{"t":"hello"}' }));
    expect(host.sent.at(-1)).toEqual({ type: "from", phone: phoneId, data: '{"t":"hello"}' });

    link.webSocketMessage(host as never, JSON.stringify({ type: "to", phone: phoneId, data: '{"t":"chats","chats":[]}' }));
    expect(phone.sent.at(-1)).toEqual({ type: "from", host: "laptop-1", data: '{"t":"chats","chats":[]}' });

    link.webSocketMessage(phone as never, JSON.stringify({ type: "to", host: "someone-else", data: "{}" }));
    expect(phone.sent.at(-1)).toEqual({ type: "gone", host: "someone-else" });
  });

  it("lets the computer send a phone away, and says when the computer leaves", async () => {
    const { link, join } = room();
    const host = await join("host", "?device=pc");
    const phone = await join("phone");
    link.webSocketMessage(host as never, JSON.stringify({ type: "kick", phone: (phone.attachment as { id: string }).id }));
    expect(phone.closed?.code).toBe(4403);
    const second = await join("phone");
    host.close(1000, "bye");
    link.webSocketClose(host as never);
    expect(second.sent.at(-1)).toEqual({ type: "hosts", hosts: [] });
  });

  it("closes a phone that floods the room", async () => {
    const { link, join } = room();
    await join("host", "?device=pc");
    const phone = await join("phone");
    for (let i = 0; i < 300 && phone.closed === null; i++) link.webSocketMessage(phone as never, JSON.stringify({ type: "ping" }));
    expect(phone.closed?.code).toBe(1008);
  });

  it("only lets a signed-in account into its own room, and a phone only from the site", async () => {
    const reached: string[] = [];
    const env = { PHONE_LINKS: { getByName: (uid: string) => ({ fetch: async () => { reached.push(uid); return new Response("ok"); } }) } };
    const verify = async (token: string) => (token === "good" ? { uid: "ana" } : null);
    const origins = ["https://web.bluethenics.com"];
    const ws = { upgrade: "websocket" };

    await phoneLinkRoute(new Request("https://p/phone/host", { headers: { ...ws, authorization: "Bearer good" } }), env as never, verify, origins);
    expect(reached).toEqual(["ana"]);

    const bad = await phoneLinkRoute(new Request("https://p/phone/host", { headers: { ...ws, authorization: "Bearer nope" } }), env as never, verify, origins);
    expect(bad.status).toBe(401);

    const elsewhere = await phoneLinkRoute(new Request("https://p/phone/phone", { headers: { ...ws, origin: "https://evil.example", "sec-websocket-protocol": "adcode.phone.v1, auth.good" } }), env as never, verify, origins);
    expect(elsewhere.status).toBe(403);

    await phoneLinkRoute(new Request("https://p/phone/phone", { headers: { ...ws, origin: "https://web.bluethenics.com", "sec-websocket-protocol": "adcode.phone.v1, auth.good" } }), env as never, verify, origins);
    expect(reached).toEqual(["ana", "ana"]);
  });
});
