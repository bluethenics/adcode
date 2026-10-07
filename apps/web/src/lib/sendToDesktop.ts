/**
 * Sending a phone visitor's install link to their computer.
 *
 * A phone cannot install a desktop editor, and asking someone who tapped a post to come
 * back later on another device mostly means they will not. Sending themselves the link
 * while they still care is the next best thing - through the share sheet where there is one,
 * by copying it where there is not. The hero and the bar that follows the reader down the
 * page both call this, so a tap does the same thing wherever it lands.
 */
export type SendOutcome = "shared" | "copied" | "dismissed" | "failed";

/** The parts of `navigator` this needs - passed in, so it is tested without a phone. */
export interface ShareTarget {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

export const SEND_SUBJECT = "Install ADCode on my computer";
export const SEND_TEXT = "ADCode - the free AI code editor that pays you to build.";

export function installLinkFor(origin: string): string {
  return `${origin}/versions?utm_source=send-to-desktop`;
}

export async function sendInstallLink(target: ShareTarget, link: string): Promise<SendOutcome> {
  try {
    if (typeof target.share === "function") {
      await target.share({ title: SEND_SUBJECT, text: SEND_TEXT, url: link });
      return "shared";
    }
    if (target.clipboard === undefined) return "failed";
    await target.clipboard.writeText(link);
    return "copied";
  } catch (error) {
    // Dismissing the share sheet is not a failure; there is nothing to report.
    if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
    return "failed";
  }
}
