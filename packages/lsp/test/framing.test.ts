import { describe, it, expect } from "vitest";
import { createMessageReader, encodeMessage } from "../src/index.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function frame(body: string): Uint8Array {
  const bytes = encode(body);
  return encode(`Content-Length: ${bytes.length}\r\n\r\n${body}`);
}

describe("encodeMessage", () => {
  it("writes a header whose length is the body's byte count", () => {
    const bytes = encodeMessage({ jsonrpc: "2.0", method: "ping" });
    const text = new TextDecoder().decode(bytes);

    const body = text.slice(text.indexOf("\r\n\r\n") + 4);
    expect(text.startsWith(`Content-Length: ${encode(body).length}\r\n\r\n`)).toBe(true);
  });

  it("counts bytes, not characters, for a body with non-ASCII in it", () => {
    // The bug this test exists for. `café` is 5 bytes and 4 characters; a header written
    // from `.length` sends 4, the server reads 4 bytes, and every message after it is
    // misaligned. The stream dies silently and nothing anywhere says why.
    const bytes = encodeMessage({ message: "café" });
    const text = new TextDecoder().decode(bytes);
    const body = text.slice(text.indexOf("\r\n\r\n") + 4);

    expect(encode(body).length).toBeGreaterThan(body.length);
    expect(text).toContain(`Content-Length: ${encode(body).length}\r\n`);
  });
});

describe("createMessageReader", () => {
  it("reads one whole message", () => {
    const reader = createMessageReader();

    expect(reader.push(frame('{"id":1}'))).toEqual(['{"id":1}']);
    expect(reader.pending()).toBe(0);
  });

  it("reads several messages that arrived in one chunk", () => {
    const reader = createMessageReader();
    const both = new Uint8Array([...frame('{"id":1}'), ...frame('{"id":2}')]);

    expect(reader.push(both)).toEqual(['{"id":1}', '{"id":2}']);
  });

  it("waits for a body split across chunks", () => {
    // A pipe delivers whatever the OS felt like. Half a message is the normal case, not
    // the exotic one.
    const reader = createMessageReader();
    const whole = frame('{"id":1,"result":"hello"}');

    expect(reader.push(whole.slice(0, 12))).toEqual([]);
    expect(reader.push(whole.slice(12, 30))).toEqual([]);
    expect(reader.push(whole.slice(30))).toEqual(['{"id":1,"result":"hello"}']);
  });

  it("waits for a header split mid-way through its own name", () => {
    const reader = createMessageReader();
    const whole = frame('{"id":7}');

    expect(reader.push(whole.slice(0, 5))).toEqual([]);
    expect(reader.push(whole.slice(5))).toEqual(['{"id":7}']);
  });

  it("slices on byte boundaries, so a multi-byte body does not corrupt the next message", () => {
    // The reader's half of the byte-vs-character bug. Slicing by string index here takes
    // too few bytes, leaving the tail of one message glued to the head of the next.
    const reader = createMessageReader();
    const first = frame('{"m":"café ☕"}');
    const second = frame('{"m":"next"}');

    const result = reader.push(new Uint8Array([...first, ...second]));

    expect(result).toEqual(['{"m":"café ☕"}', '{"m":"next"}']);
  });

  it("survives a message arriving one byte at a time", () => {
    const reader = createMessageReader();
    const whole = frame('{"id":3}');

    const seen: string[] = [];
    for (const byte of whole) seen.push(...reader.push(new Uint8Array([byte])));

    expect(seen).toEqual(['{"id":3}']);
  });

  it("tolerates extra headers, which several servers send", () => {
    const reader = createMessageReader();
    const body = '{"id":9}';
    const chunk = encode(
      `Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${body}`,
    );

    expect(reader.push(chunk)).toEqual([body]);
  });

  it("matches the header case-insensitively", () => {
    const reader = createMessageReader();
    const body = '{"id":4}';

    expect(reader.push(encode(`content-length: ${body.length}\r\n\r\n${body}`))).toEqual([body]);
  });

  it("drops a header block with no length rather than blocking everything behind it", () => {
    const reader = createMessageReader();
    const junk = encode("Something-Else: 1\r\n\r\n");

    expect(reader.push(new Uint8Array([...junk, ...frame('{"id":5}')]))).toEqual(['{"id":5}']);
  });

  it("refuses an absurd length instead of buffering forever", () => {
    // The header comes from a subprocess. A length of a terabyte must not turn into a
    // reader that waits for one, holding everything after it hostage.
    const reader = createMessageReader();
    const hostile = encode("Content-Length: 999999999999999\r\n\r\n");

    expect(reader.push(new Uint8Array([...hostile, ...frame('{"id":6}')]))).toEqual(['{"id":6}']);
  });

  it("returns nothing for an empty push", () => {
    const reader = createMessageReader();
    expect(reader.push(new Uint8Array(0))).toEqual([]);
  });

  it("round-trips what encodeMessage produced", () => {
    const reader = createMessageReader();
    const payload = { jsonrpc: "2.0", id: 1, method: "textDocument/didOpen", params: { text: "ü" } };

    const [body] = reader.push(encodeMessage(payload));

    expect(JSON.parse(body ?? "null")).toEqual(payload);
  });
});
