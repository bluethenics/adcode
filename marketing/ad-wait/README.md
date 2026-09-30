# The Wait — 8-second launch ad

1080 × 1080, 60 fps (plus a 30 fps copy), H.264 + AAC, about −14 LUFS. "Get paid to wait."

Built for a feed where most people leave early: the money is on screen in frame 0, half the
film is hard cuts that speed up (1 s → a sixth of a second), a quarter-second of silence
gates the notification's hit, and the last frame cuts straight back into the first so a
replay is seamless. It reads with the sound off.

Same rules as the Payback ad: the only colour is money, the advertiser is the fictional
Acme Cloud, claims limited to "Free.", "Half the ad money is yours." and "Windows & Linux".
The amounts (+$0.04) are examples and the small print says so — there is no documented
per-ad rate.

```
node marketing/ad-payback/fetch-tools.mjs      # once: ffmpeg and fonts, shared with Payback
node marketing/ad-wait/render.mjs              # the deliverable, into out/
node marketing/ad-wait/render.mjs --preview    # loop it in a window
node marketing/ad-wait/render.mjs --stills 0,4.6,7.5
node marketing/ad-wait/verify.mjs              # 23 delivery and retention checks
```

The cue sheet is `stage/cues.js`; the picture and the soundtrack both read it. Frame engine
and drawing kit are borrowed from `ad-payback/stage` via the `/shared/` route.
