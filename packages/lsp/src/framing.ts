/**
 * The wire format: `Content-Length: N\r\n\r\n` followed by N bytes of JSON.
 *
 * Two things about it are easy to get wrong and both produce the same symptom - a language
 * server that works for a while and then goes silent, with nothing in any log to say why.
 *
 * **N is a count of bytes, not characters.** A diagnostic mentioning `café` or a Chinese
 * identifier is longer in UTF-8 than in UTF-16 code units, so slicing the buffer by string
 * index takes the wrong number of bytes. Every subsequent message is then misaligned and
 * the stream is dead. So the reader works entirely in bytes and only decodes once it holds
 * a complete, exactly-bounded message.
 *
 * **A chunk is not a message.** A pipe delivers whatever the OS felt like: half a header,
 * three messages at once, a body split across four reads. The reader is therefore a
 * accumulator that yields zero or more complete messages per push.
 *
 * No `node:` imports - `TextEncoder` and `TextDecoder` are standard globals - so this is
 * testable without a subprocess, which is the only way the awkward cases above ever get
 * exercised at all.
 */

const CONTENT_LENGTH = /content-length:\s*(\d+)/i;

/**
 * Anything longer than this is a bug or an attack, not a message.
 *
 * The header arrives from a subprocess and is trusted only as far as it has to be. A
 * `Content-Length: 999999999999` would otherwise make the reader wait forever while the
 * accumulated buffer grows without bound.
 */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encodeMessage(payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);

  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

export interface MessageReader {
  /** Feed bytes; get back whatever complete message bodies they completed. */
  push(chunk: Uint8Array): string[];
  /** Bytes held back waiting for the rest of a message. Diagnostics only. */
  pending(): number;
}

/** `\r\n\r\n`, the end of the header block. */
const SEPARATOR = [13, 10, 13, 10];

function indexOfSeparator(bytes: Uint8Array, from: number): number {
  for (let index = from; index + 3 < bytes.length; index += 1) {
    if (
      bytes[index] === SEPARATOR[0] &&
      bytes[index + 1] === SEPARATOR[1] &&
      bytes[index + 2] === SEPARATOR[2] &&
      bytes[index + 3] === SEPARATOR[3]
    ) {
      return index;
    }
  }
  return -1;
}

export function createMessageReader(): MessageReader {
  let buffer = new Uint8Array(0);
  const decoder = new TextDecoder();

  function append(chunk: Uint8Array): void {
    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer, 0);
    next.set(chunk, buffer.length);
    buffer = next;
  }

  return {
    push(chunk) {
      append(chunk);

      const messages: string[] = [];

      for (;;) {
        const headerEnd = indexOfSeparator(buffer, 0);
        if (headerEnd === -1) break;

        const header = decoder.decode(buffer.subarray(0, headerEnd));
        const match = CONTENT_LENGTH.exec(header);

        if (match === null) {
          // A header block with no length is unusable, and keeping it would block every
          // message behind it forever. Drop it and resynchronise on the next one.
          buffer = buffer.slice(headerEnd + SEPARATOR.length);
          continue;
        }

        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
          buffer = buffer.slice(headerEnd + SEPARATOR.length);
          continue;
        }

        const start = headerEnd + SEPARATOR.length;
        if (buffer.length < start + length) break;

        messages.push(decoder.decode(buffer.subarray(start, start + length)));
        buffer = buffer.slice(start + length);
      }

      return messages;
    },

    pending: () => buffer.length,
  };
}
