import { expect, it } from "vitest";
import { formatMessageTime } from "../src/renderer/ai/messageTime.ts";

// Built from local dates, so the test reads the same in any time zone.
const now = new Date(2026, 10, 26, 15, 0).getTime(); // Thu 26 Nov 2026, 15:00
const at = (day: number, hour: number, minute: number, month = 10, year = 2026): number => new Date(year, month, day, hour, minute).getTime();
const text = (when: number): string => formatMessageTime(when, now, "en-GB").text;

it("shows the clock time a message was sent, never a relative label that goes stale", () => {
  expect(text(now - 5_000)).toBe("14:59");
  expect(text(at(26, 9, 5))).toBe("09:05");
  expect(text(at(26, 0, 0))).toBe("00:00");
  expect(text(at(25, 23, 59))).toBe("Yesterday 23:59");
  expect(text(at(25, 8, 30))).toBe("Yesterday 08:30");
  expect(text(at(23, 14, 32))).toBe("Mon 14:32");
  expect(text(at(12, 14, 32))).toBe("12 Nov, 14:32");
  expect(text(at(3, 7, 15, 0, 2025))).toBe("3 Jan 2025, 07:15");
  // A message from a device whose clock is a little ahead still reads as a time today.
  expect(text(now + 30_000)).toBe("15:00");
});

it("keeps the full date for hovering", () => {
  expect(formatMessageTime(at(26, 14, 32), now, "en-GB").title).toMatch(/Thu.*26 Nov 2026.*14:32/);
});
