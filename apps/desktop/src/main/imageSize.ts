/**
 * How big a picture is, read from its first bytes - and whether a model will take it.
 *
 * Reported (2.5.1): "Supplied image did not pass validation checks. The image is 90x30
 * pixels; images must be at least 64x64 pixels." A small icon attached to a message, or
 * opened by the assistant with read_file, ended the whole task with a provider error nobody
 * could act on. Providers refuse pictures under 64 pixels on a side, so such a picture is
 * left out here, with a sentence saying so, instead of being sent to fail.
 *
 * Header parsing only: no decoder, no Electron, so it runs the same on the desktop and the
 * web host. An image whose size cannot be read is treated as fine and sent as before.
 */
export interface ImageSize { readonly width: number; readonly height: number }

/** The smallest side providers accept. Anthropic and its relays say 64; nobody asks for more. */
export const MIN_IMAGE_SIDE = 64;

function png(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gif(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 10 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) };
}

function jpeg(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    // Start-of-frame markers carry the size; C4, C8 and CC share the range but are tables.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webp(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30 || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[8] !== 0x57 || bytes[9] !== 0x45) return null;
  const kind = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (kind === "VP8 ") return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
  if (kind === "VP8L") {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { width: (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1, height: (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1 };
  return null;
}

/** The picture's size in pixels, or null when the bytes are not a PNG, JPEG, GIF or WebP this can read. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const size = png(bytes) ?? gif(bytes) ?? jpeg(bytes) ?? webp(bytes);
  return size !== null && size.width > 0 && size.height > 0 ? size : null;
}

/** The size of a base64 picture. Only the start is decoded: a header is all it takes. */
export function base64ImageSize(data: string): ImageSize | null {
  try {
    // JPEG keeps its size after its metadata, which can run to tens of kilobytes.
    return imageSize(Buffer.from(data.slice(0, 262_144), "base64"));
  } catch {
    return null;
  }
}

/** Why a model would refuse this picture, in a sentence, or null when it would take it. */
export function tooSmallForModels(size: ImageSize | null): string | null {
  if (size === null || (size.width >= MIN_IMAGE_SIDE && size.height >= MIN_IMAGE_SIDE)) return null;
  return `${size.width.toString()}x${size.height.toString()} pixels, and models only look at pictures at least ${MIN_IMAGE_SIDE.toString()}x${MIN_IMAGE_SIDE.toString()}`;
}
