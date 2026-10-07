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
