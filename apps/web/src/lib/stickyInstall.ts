/**
 * What the install bar that follows a reader down the home page offers, per machine.
 *
 * The hero and the closing section were the only install buttons, with a long page between
 * them. The bar repeats the hero's choice in one line - the Store installer on Windows, the
 * .deb on Linux - and on a phone, which cannot run a desktop editor, it sends the link to the
 * reader's computer in one tap (sendToDesktop.ts). Pure, so the routing is tested rather than
 * eyed.
 */
import { installRoute, LINUX_DOWNLOADS, MICROSOFT_STORE, type Platform } from "./platform";

export interface StickyInstallAction {
  /**
   * `download` starts a file; `send` shares or copies the install link, falling back to the
   * hero (`href`) if the phone allows neither; `link` opens another page.
   */
  kind: "download" | "send" | "link";
  label: string;
  detail: string;
  href: string;
}

export function stickyInstallAction(platform: Platform, repo: string): StickyInstallAction {
  switch (installRoute(platform)) {
    case "store":
      return { kind: "download", label: "Download for Windows", detail: "Free · Microsoft Store", href: MICROSOFT_STORE.installerUrl("sticky") };
    case "download":
      return { kind: "download", label: "Download for Linux", detail: "Free · .deb", href: LINUX_DOWNLOADS(repo).deb };
    case "send":
      return { kind: "send", label: "Send to my computer", detail: "It runs on Windows and Linux", href: "#earn" };
    default:
      return { kind: "link", label: "Get ADCode", detail: "Free · Windows and Linux", href: "/versions" };
  }
}
