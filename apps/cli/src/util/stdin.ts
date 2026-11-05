import { fstatSync } from "node:fs";

/**
 * Text piped into the CLI: `git diff | adcode chat "review this"`.
 *
 * A terminal is never read. A pipe or a redirected file is read to the end. Some tools
 * start child processes with a pipe that stays open and never sends anything; rather than
 * hang there forever, give up when nothing at all has arrived after `idleMs`. Once the
 * first byte arrives, the rest is read to the end however slowly it comes.
 */

export const PIPED_LIMIT = 400_000;

export interface PipedInput {
  readonly text: string;
  readonly truncated: boolean;
}

function looksPiped(stream: NodeJS.ReadStream): boolean {
  if (stream.isTTY === true) return false;
  const fd = (stream as { fd?: unknown }).fd;
  if (typeof fd !== "number") return true;
  try {
    const stat = fstatSync(fd);
    // On Windows a pipe carries the S_IFIFO mode bits, yet isFIFO() reports false.
    return stat.isFIFO() || stat.isFile() || stat.isSocket() || (stat.mode & 0o170000) === 0o010000;
  } catch {
    return false;
  }
}

export function readPipedInput(stream: NodeJS.ReadStream, options: { idleMs?: number; limit?: number } = {}): Promise<PipedInput | null> {
  if (!looksPiped(stream)) return Promise.resolve(null);
  const idleMs = options.idleMs ?? 1500;
  const limit = options.limit ?? PIPED_LIMIT;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      stream.off("data", onData);
      stream.off("end", finish);
      stream.off("error", finish);
      stream.pause();
      const raw = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
      const text = raw.replace(/\s+$/, "");
      if (text.trim().length === 0) {
        resolve(null);
        return;
      }
      resolve(text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false });
    };
    const onData = (chunk: Buffer | string): void => {
      clearTimeout(idle);
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (size <= limit * 4) chunks.push(buffer);
      size += buffer.length;
    };
    const idle = setTimeout(() => {
      if (size === 0) finish();
    }, idleMs);
    stream.on("data", onData);
    stream.once("end", finish);
    stream.once("error", finish);
    stream.resume();
  });
}

/** The message the model sees: the typed question, then the piped text in a fence that cannot close early. */
export function combinePrompt(typed: string, piped: PipedInput | null): string {
  if (piped === null) return typed;
  const note = piped.truncated ? `\n\n(The input was longer than ${PIPED_LIMIT.toLocaleString("en-US")} characters and was cut there.)` : "";
  if (typed.length === 0) return `${piped.text}${note}`;
  const longest = Math.max(2, ...[...piped.text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${typed}\n\n${fence}\n${piped.text}\n${fence}${note}`;
}
