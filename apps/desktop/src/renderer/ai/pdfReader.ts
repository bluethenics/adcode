/**
 * PDF.js, loaded the first time someone attaches a PDF and not before.
 *
 * It parses in its own worker, served from the app like Monaco's (the CSP's `worker-src 'self'`),
 * so a long PDF does not freeze the window and a hostile one is opened in the sandbox, never in
 * the main process. Fonts are not loaded into the page (`disableFontFace`) and nothing is
 * fetched: the bytes are handed over and only the text comes back.
 */
import { DocumentError, type PdfLike } from "./documentText.ts";

type PdfJs = typeof import("pdfjs-dist");

let loading: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  loading ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([library, worker]) => {
    library.GlobalWorkerOptions.workerSrc = worker.default;
    return library;
  }).catch((error: unknown) => {
    // A failed load is retried with the next PDF rather than remembered forever.
    loading = null;
    throw error;
  });
  return loading;
}

/** Opens one PDF's bytes; the refusal is a sentence naming the file. */
export function pdfOpener(name: string): (bytes: Uint8Array) => Promise<PdfLike> {
  return async (bytes) => {
    const library = await pdfjs().catch(() => {
      throw new DocumentError(`${name} could not be read: the PDF reader did not load. Try again.`);
    });
    try {
      return await library.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise;
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "PasswordException") {
        throw new DocumentError(`${name} is password-protected. Remove the password, or copy the text into the chat.`);
      }
      throw new DocumentError(`${name} could not be opened as a PDF - the file looks damaged.`);
    }
  };
}
