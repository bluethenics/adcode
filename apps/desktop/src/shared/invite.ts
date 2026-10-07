/**
 * What an invite looks like on the way into the editor.
 *
 * The Microsoft Store installer cannot carry a link's `?ref=` into the app, so a code
 * travels by hand: the invite page copies `ADCode invite: <code>` to the clipboard as the
 * download starts, and the welcome screen looks for exactly that. Two readers, two rules:
 *
 * - **The clipboard** is read without the person doing anything, so only the invite line or
 *   an invite link counts. A bare seven-letter word is ignored: on a developer's clipboard
 *   it is far more likely to be a variable name, a token or a password than an invite, and
 *   whatever is ignored here never leaves the machine.
 * - **The box** someone types into is a deliberate act, so a bare code is fine there too.
 *
 * The service has its own copy of these rules (`services/api/src/referrals.ts`); it checks
 * whatever arrives again, so this side only decides what is worth sending.
 */

export const INVITE_ORIGIN = "https://adcode.bluethenics.com";
export const INVITE_PREFIX = "ADCode invite: ";

const CODE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const LINE = /^adcode invite:\s*([a-z0-9-]+)$/i;
const LINK = /^(?:https?:\/\/)?(?:www\.)?adcode\.bluethenics\.com\/i\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;
const BARE = /^[a-z0-9-]+$/i;

const valid = (found: string | undefined): string | null => {
  const code = found?.toLowerCase();
  return code !== undefined && CODE.test(code) ? code : null;
};

/** The code in clipboard text that is an invite line or link and nothing else, or null. */
export function parseInviteText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  return valid(LINE.exec(trimmed)?.[1] ?? LINK.exec(trimmed)?.[1]);
}

/** The code in something a person typed into the invite box: the line, a link, or the bare code. */
export function parseInviteInput(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > 300) return null;
  return parseInviteText(trimmed) ?? (BARE.test(trimmed) ? valid(trimmed) : null);
}

/** `https://adcode.bluethenics.com/i/<code>`, with `?from=` naming where it was shared from. */
export function inviteLink(code: string, from?: string): string {
  return `${INVITE_ORIGIN}/i/${code}${from === undefined ? "" : `?from=${encodeURIComponent(from)}`}`;
}

/** Exactly what the invite page puts on the clipboard. */
export function inviteLine(code: string): string {
  return `${INVITE_PREFIX}${code}`;
}

export type ShareTarget = "x" | "threads" | "email";

/** The line that goes with a shared link: what ADCode is, in the words a person would use. */
export const SHARE_TEXT = "I code in ADCode - the AI is free and the ads pay me. Here's my invite:";

/** Where each share button goes. Built in main from the account's own code, never from the renderer. */
export function shareUrl(target: ShareTarget, link: string): string {
  if (target === "x") return `https://x.com/intent/post?text=${encodeURIComponent(`${SHARE_TEXT} ${link}`)}`;
  if (target === "threads") return `https://www.threads.com/intent/post?text=${encodeURIComponent(`${SHARE_TEXT} ${link}`)}`;
  return `mailto:?subject=${encodeURIComponent("Try ADCode with me")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${link}`)}`;
}

const BUILT_WITH = /Built with \[ADCode\]\(/;

/**
 * A README with one "Built with ADCode" line added, or null when it already has one.
 *
 * Only ever done when the person presses the button for it. New projects start as empty
 * folders on purpose (`main/newProject.ts`), and a line nobody asked for in somebody's
 * README is not a loop, it is graffiti.
 */
export function withBuiltWithLine(readme: string | null, link: string): string | null {
  const line = `Built with [ADCode](${link})`;
  if (readme === null || readme.trim() === "") return `${line}\n`;
  if (BUILT_WITH.test(readme)) return null;
  const nl = readme.includes("\r\n") ? "\r\n" : "\n";
  return `${readme.replace(/(\r?\n)+$/, "")}${nl}${nl}${line}${nl}`;
}

/** What to send someone who has to install ADCode before they can join a live session. */
export function collabInviteText(link: string, sessionCode: string): string {
  return [
    "Join my live coding session in ADCode.",
    "",
    `1. Install ADCode (free): ${link}`,
    `2. Open Live Session, choose Join, and paste: ${sessionCode}`,
  ].join("\n");
}
