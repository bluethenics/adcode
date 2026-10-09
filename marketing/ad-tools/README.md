# Too Many Tools — 22.5-second brand film

1920 × 1080, 60 fps (plus a 30 fps copy), H.264 + AAC, about −14 LUFS. Design:
`docs/superpowers/specs/2026-09-30-too-many-tools-film-design.md`.

One idea turns into six tools, and the tools turn into a loop: copy from the chat, paste in
the editor, refresh the browser, copy the error from the terminal, paste it back. Every
round is faster. Then a hard cut to silence and a display turning in the dark: "Your code
lives in too many tools." A giant "Zero": copy‑paste, then tab‑switching. The tools fly home
into one ADCode window, a sentence becomes an edit and the tests pass. A sponsored card
flips and its back is a green 50%: "Half the ad money is yours." Then the `<$>` mark and
the end card.

The rules from the Payback and Wait ads hold:
- The only colour is money, `#30D158`, and only once the 50% arrives.
- The advertiser is the fictional Acme Cloud.
- There are no competitor names or logos, no prices for other tools, and no "free AI".
- The claims are limited to "Free. No subscription.", "Half the ad money is yours." and
  "Windows & Linux".

```
node marketing/ad-payback/fetch-tools.mjs          # once: ffmpeg and fonts, shared
node marketing/ad-tools/render.mjs                 # the deliverable, into out/ (~15 min)
node marketing/ad-tools/render.mjs --preview       # loop it in a window
node marketing/ad-tools/render.mjs --stills 0.95,11.5,20
node marketing/ad-tools/render.mjs --from 3.5 --to 7 --no-audio --blur 1   # a quick slice
node marketing/ad-tools/verify.mjs                 # delivery, copy, colour and sound checks
```

How it is made:
- **One timing table.** `stage/cues.js` is read by the picture, the soundtrack and the
  verify script.
- **Real camera moves.** Scenes are CSS 3D worlds filmed through the camera in `stage/fx.js`.
- **Real motion blur.** Each frame averages samples across a 180° shutter that opens at the
  frame's own time, so it never straddles a hard cut. A frame that moves a lot is shot
  again with up to 32 samples.
- **Grain** is added in ffmpeg, on luma only, after the average.
- **Shared code.** The frame engine and the drawing kit (the mark, the mascots and the icons)
  come from `ad-payback/stage` via the `/shared/` route.
