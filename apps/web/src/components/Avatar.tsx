"use client";

import { useEffect, useState } from "react";

/**
 * Someone's face, or their initial.
 *
 * Google and GitHub both hand back a `photoURL` with the account. Drawing only the
 * initial when a real picture exists made every signed-in account look like a placeholder.
 *
 * The fallback is not optional, though, and it is not only for accounts without a photo.
 * A Google avatar URL is served from `lh3.googleusercontent.com`, which rate-limits, goes
 * 404 when someone changes their picture, and is blocked outright on networks that filter
 * Google domains. In every one of those cases the `<img>` fires `error` and, without this,
 * leaves a broken-image glyph where a person's face should be. So the photo is attempted,
 * and the initial is what is actually rendered until the photo has provably loaded.
 *
 * The `src` is also tracked in state and reset when it changes, so signing out of one
 * account and into another does not leave the previous person's face on screen.
 */
export function Avatar({
  photoUrl,
  label,
  size = "sm",
}: {
  photoUrl: string | null;
  label: string;
  size?: "sm" | "lg";
}) {
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");

  useEffect(() => setState("pending"), [photoUrl]);

  // The first letter of the email, or of the uid when there is no email - an anonymous
  // account still gets a face rather than a blank circle.
  const initial = (label.trim()[0] ?? "?").toUpperCase();
  const showPhoto = photoUrl !== null && state !== "failed";

  return (
    <span className={`avatar${size === "lg" ? " avatar-lg" : ""}`} aria-hidden="true">
      {/* Underneath the photo, not instead of it: it covers the gap while the image is in
          flight, so the circle never flashes empty. */}
      <span className="avatar-initial" data-hidden={state === "loaded" ? "true" : undefined}>
        {initial}
      </span>

      {showPhoto && (
        // eslint-disable-next-line @next/next/no-img-element -- a third-party avatar URL
        // at a fixed 30 or 42px. Routing it through next/image would proxy every
        // provider's CDN through the Worker for no gain.
        <img
          className="avatar-photo"
          src={photoUrl}
          alt=""
          width={size === "lg" ? 42 : 30}
          height={size === "lg" ? 42 : 30}
          // `referrerPolicy` matters: Google's avatar host returns 403 for a request
          // carrying a referrer it does not recognise, which is every deployment of this
          // site. Sending none is what makes the picture load at all.
          referrerPolicy="no-referrer"
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      )}
    </span>
  );
}
