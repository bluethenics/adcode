import type { Metadata } from "next";
import { DesktopSignIn } from "./DesktopSignIn";
export const metadata: Metadata = { title: "Sign in to ADCode desktop", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <DesktopSignIn />; }
