# ADCode — Your idea. An AI crew.

Two finished Instagram mascot reels, each 20 s, 1080 × 1920, 30 fps, H.264/AAC. Exact existing ADCode agent art, five starter identities, original stereo music/effects, readable first frame, central safe-zone copy and one download CTA.

H1: “Still coding alone?” H2: “Your idea. An AI crew.” The opening text and its brief return at the end differ; the shared story and soundtrack match. Product footage is a labeled motion illustration. This film advertises a free editor and accurately requires the user's AI key or local model; it promises neither free cloud inference nor fixed earnings.

See [POSTING.md](POSTING.md) for the caption, source-linked evidence, upload steps and acquisition measurement plan. Evidence-backed format choices and unproven creative hypotheses are explicitly distinguished.

Run from the repository root:

```text
node marketing/ad-mascot-reel/render.mjs --hook 1
node marketing/ad-mascot-reel/render.mjs --hook 2
node marketing/ad-mascot-reel/render.mjs --hook 1 --stills 0,4.8,7.4,10.5,13,17.5
node marketing/ad-mascot-reel/verify.mjs
```

Render dependencies are already shared with `marketing/ad-payback`: repository Electron, FFmpeg and the existing licensed fonts. No external generation service is needed. `stage/film.js` controls the animation; `stage/mascots.js` copies the canonical agent paths; `stage/audio.js` creates the original soundtrack. Output files and verification reports live in `out/`.
