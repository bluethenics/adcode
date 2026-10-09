/**
 * The recording of the desktop live room on the homepage.
 *
 * Written by `node scripts/smoke-live-agents.mjs --record` from the built app; re-record after
 * the live room's look changes, so the site shows what the app shows.
 */
export const liveRecording = {
  poster: "/videos/live-room.webp",
  webm: "/videos/live-room.webm",
  mp4: "/videos/live-room.mp4",
  width: 1280,
  height: 942,
} as const;
