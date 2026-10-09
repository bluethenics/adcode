# Pays You: 10-second 1:1 direct-response ad, three hooks

1080 × 1080, 60 fps (plus a 30 fps copy), H.264 + AAC, about −14 LUFS, BT.709. Design:
`docs/superpowers/specs/2026-10-01-pays-you-ad-design.md`. How to run it on X: `POSTING.md`.

Built from what the boosted posts showed: people decided in the first second and left.

**Frame 0 is the finished hook.** X shows it as the poster, so the offer is readable before anything plays. There are three openings:
- H1: "This code editor pays you."
- H2: "Get paid to code."
- H3: "Your IDE shows ads. You keep half."

The money line is in money green, and the earnings chip ticks under it.

**The rest of the ad is identical in all three files:**
1. The chip flies into the title bar of a real ADCode window.
2. The AI writes a file.
3. A sponsored card pays out into the chip.
4. Four cuts, one word each: Agents, Terminal, Git, Preview.
5. The end card: the mark lands at 6.5 s, and the mark, "Free · Open source · Windows & Linux" and the address are all readable from 6.95 s to the end.

**Rules:**
- The only colour is money.
- The advertiser is the fictional Acme Cloud.
- Amounts are examples, and "Example amounts. Earnings vary." stays on screen throughout.
- "Open source" must be live before posting.

```
node marketing/ad-payback/fetch-tools.mjs        # once: ffmpeg and fonts, shared
node marketing/ad-pays/render.mjs                # all three hooks into out/
node marketing/ad-pays/render.mjs --hook 2       # one hook
node marketing/ad-pays/render.mjs --hook 1 --stills 0,3.7,8
node marketing/ad-pays/render.mjs --hook 3 --preview
node marketing/ad-pays/verify.mjs                # delivery, copy, colour, hook and sound checks
```

**Where things live:**
- `stage/cues.js` is the only timing table, and it also holds the three hooks.
- The renderer is the same adaptive motion-blur pipeline as `ad-tools`, sized from the cue sheet.
- The frame engine and the drawing kit come from `ad-payback/stage` via `/shared/`.
