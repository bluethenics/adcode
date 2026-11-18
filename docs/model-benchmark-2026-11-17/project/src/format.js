import { roundTo } from "./round.js";

const UNITS = ["B", "KB", "MB", "GB"];

/** A byte count for people: 1536 -> "1.5 KB". */
export function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  while (value > 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${roundTo(value, 1)} ${UNITS[unit]}`;
}
