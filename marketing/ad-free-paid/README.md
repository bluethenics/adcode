# Free, then Paid — 16.5-second square spot

1080 × 1080, 60 fps (plus a 30 fps copy), H.264 + AAC at about −14 LUFS. Built for the X and
Instagram feeds: the offer is readable on frame 0, the spot reads muted, and the end card
holds. Design: `docs/superpowers/specs/2026-10-02-free-paid-film-design.md`.

Too Many Tools' craft (a real 3D camera, motion blur, dust, grain, black and chrome) carrying
a direct offer: the free AI code editor, and you get paid while your AI works.

| Time | Scene |
| --- | --- |
| 0–2 s | **Hook, finished on frame 0.** The mark, ADCode, and "The free AI code editor." in chrome. A sheen, an underline on "free", then the camera punches through the line into white. |
| 2–4.5 s | **Build.** ADCode's Vibe window in 3D. "Build me a habit tracker" types and sends; the agent's clock races. "Your AI is working…" |
| 4.5–7 s | **Paid to wait.** An Acme Cloud card slides into the corner, "+$0.04" pops and flies into the sidebar's earnings, which turn green. "Get paid to wait." slams in, "paid" in green. The habit tracker appears in Preview. |
| 7–10.3 s | **The split.** The card lifts and flips: "This ad paid $0.08". It cracks and breaks in two: YOU 50% +$0.04 in green, ADCODE 50% in grey. "Half the ad money is yours." |
| 10.5–13 s | **Montage.** Whips across Vibe (four agents finishing), Code (a line typing under the floating assistant, tests passing) and Earnings (the balance counting up). "Vibe or Code. Earn in both." The camera dives into the balance. |
| 13–16.5 s | **End card.** The money point becomes the `<$>` mark. ADCode · "Get paid to wait." · "Free. Half the ad money is yours." · Windows & Linux · adcode.bluethenics.com · "Use your own AI key or a local model." |

```
node marketing/ad-payback/fetch-tools.mjs            # once: ffmpeg and fonts, shared
node marketing/ad-free-paid/render.mjs               # the deliverable, into out/ (~15 min)
node marketing/ad-free-paid/render.mjs --stills 0,6.4,9,16
node marketing/ad-free-paid/render.mjs --from 4 --to 8 --no-audio --blur 1   # a quick slice
node marketing/ad-free-paid/render.mjs --preview     # loop it in a window
node marketing/ad-free-paid/verify.mjs               # delivery, copy, colour, small print, sound
```

The rules from the earlier ads hold, with one exception that was approved:
- **"Free AI" appears only as "The free AI code editor."** That is the site's own claim:
  the editor is free and AI is built in. The end card says where the AI comes from ("Use
  your own AI key or a local model."), and verify rejects "free AI" anywhere else.
- The only colour is money, `#30D158`, from the first +$0.04.
- The advertiser is the fictional Acme Cloud. No competitor names, and no promise that every
  prompt pays.
- Amounts are examples. "Example amounts. Earnings vary. Sponsored cards are occasional."
  stays on screen for the whole spot, and verify checks every frame for it.

How it is made: `stage/cues.js` is the one timing table, read by the picture, the
soundtrack and verify. Scenes are pure functions of `t`. The Electron renderer is Too Many
Tools': up to 32 samples a frame for real motion blur, then grain in ffmpeg. The frame
engine and drawing kit come from `ad-payback/stage` via `/shared/`. The soundtrack is
synthesised offline, cue for cue: a clock under the wait, a coin on +$0.04, four slams, a
boom on the split.
