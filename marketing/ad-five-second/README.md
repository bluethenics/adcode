# adcode — Think it. Build it.

Five-second motion ad, 1080 × 1080, 60 fps, H.264 MP4 with original stereo sound design.

- 0.00–1.03: “Think it.” with a moving prompt and cursor trail.
- 1.03–2.82: “Build it.” with an animated, illustrative code + AI workspace.
- 2.82–5.00: The adcode mark assembles, followed by the brand, tagline and call to action.

The graphics use the existing adcode logo geometry and monochrome palette. The editor is a motion illustration, not a screen recording. No third-party music or stock artwork is used.

Render from the repository root with `node marketing/ad-five-second/render.mjs`.
Render only the four review frames with `node marketing/ad-five-second/render.mjs --stills`.
Uses the repository's Electron and the existing FFmpeg/fonts in `marketing/ad-payback/.tools`.
Open `stage/index.html?play` in a browser to preview the animation loop.

Final export: `out/adcode-5s-1080x1080.mp4`. Storyboard: `out/storyboard.jpg`.
