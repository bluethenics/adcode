/**
 * `Buffer`, for main-process code running in the browser host.
 *
 * A Uint8Array with the parts of Node's Buffer that `src/main` uses: from / alloc / concat /
 * byteLength / isBuffer, and utf8, base64, base64url, hex and latin1 conversion.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Encoding = "utf8" | "utf-8" | "base64" | "base64url" | "hex" | "latin1" | "binary" | "ascii";

function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const padded = clean + "===".slice((clean.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

export class Buffer extends Uint8Array<ArrayBuffer> {
  // Node's signature, not Uint8Array's: (string, encoding), (ArrayBuffer, offset, length), bytes, arrays.
  static override from(value: any, encodingOrOffset?: any, length?: any): Buffer {
    if (typeof value === "string") return Buffer.fromBytes(Buffer.encode(value, (encodingOrOffset as Encoding | undefined) ?? "utf8"));
    if (value instanceof ArrayBuffer) return new Buffer(value, typeof encodingOrOffset === "number" ? encodingOrOffset : 0, length ?? value.byteLength - (typeof encodingOrOffset === "number" ? encodingOrOffset : 0));
    if (ArrayBuffer.isView(value)) return Buffer.fromBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    if (Array.isArray(value)) return Buffer.fromBytes(Uint8Array.from(value as number[]));
    if (typeof value === "object" && value !== null && (value as { type?: unknown }).type === "Buffer") return Buffer.fromBytes(Uint8Array.from((value as { data: number[] }).data));
    throw new TypeError("The first argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.");
  }

  private static fromBytes(bytes: Uint8Array): Buffer {
    return new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  }

  private static encode(text: string, encoding: Encoding): Uint8Array {
    switch (encoding) {
      case "base64":
      case "base64url":
        return base64ToBytes(text);
      case "hex": {
        const out = new Uint8Array(Math.floor(text.length / 2));
        for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
        return out;
      }
      case "latin1":
      case "binary":
      case "ascii":
        return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
      default:
        return encoder.encode(text);
    }
  }

  static alloc(size: number, fill = 0): Buffer {
    const buffer = new Buffer(new ArrayBuffer(size));
    if (fill !== 0) buffer.fill(fill);
    return buffer;
  }

  static allocUnsafe(size: number): Buffer {
    return new Buffer(new ArrayBuffer(size));
  }

  static concat(list: readonly Uint8Array[], total?: number): Buffer {
    const length = total ?? list.reduce((sum, part) => sum + part.length, 0);
    const out = new Buffer(new ArrayBuffer(length));
    let at = 0;
    for (const part of list) {
      if (at >= length) break;
      out.set(part.subarray(0, length - at), at);
      at += part.length;
    }
    return out;
  }

  static byteLength(value: string | ArrayBufferView | ArrayBuffer, encoding: Encoding = "utf8"): number {
    if (typeof value === "string") return Buffer.encode(value, encoding).length;
    return value.byteLength;
  }

  static isBuffer(value: unknown): value is Buffer {
    return value instanceof Buffer;
  }

  static isEncoding(encoding: string): boolean {
    return ["utf8", "utf-8", "base64", "base64url", "hex", "latin1", "binary", "ascii"].includes(encoding);
  }

  override toString(encoding: Encoding = "utf8", start = 0, end = this.length): string {
    const part = this.subarray(start, end);
    switch (encoding) {
      case "base64":
        return bytesToBase64(part);
      case "base64url":
        return bytesToBase64(part).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      case "hex":
        return Array.from(part, (byte) => byte.toString(16).padStart(2, "0")).join("");
      case "latin1":
      case "binary":
      case "ascii":
        return String.fromCharCode(...part);
      default:
        return decoder.decode(part);
    }
  }

  override subarray(start?: number, end?: number): Buffer {
    const view = super.subarray(start, end);
    return new Buffer(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
  }

  override slice(start?: number, end?: number): Buffer {
    return this.subarray(start, end);
  }

  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false;
    for (let i = 0; i < this.length; i += 1) if (this[i] !== other[i]) return false;
    return true;
  }

  write(text: string, offset = 0): number {
    const bytes = encoder.encode(text).subarray(0, this.length - offset);
    this.set(bytes, offset);
    return bytes.length;
  }

  toJSON(): { type: "Buffer"; data: number[] } {
    return { type: "Buffer", data: Array.from(this) };
  }

  readUInt32BE(offset = 0): number {
    return new DataView(this.buffer, this.byteOffset).getUint32(offset, false);
  }

  readUInt16BE(offset = 0): number {
    return new DataView(this.buffer, this.byteOffset).getUint16(offset, false);
  }
}

export const constants = { MAX_LENGTH: 2 ** 31 - 1 };
export default { Buffer, constants };
