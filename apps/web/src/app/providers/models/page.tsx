import { permanentRedirect } from "next/navigation";

/** The submission page's first address, kept for links already shared. It lives at /ai-models now. */
export default function Page() { permanentRedirect("/ai-models"); }
