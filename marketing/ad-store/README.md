# Now on the Microsoft Store — 20-second launch spot

Two cuts from one timeline, 60 fps (plus 30 fps copies), H.264 + AAC at about −14 LUFS:

- **1920 × 1080**: the Microsoft Store listing trailer, YouTube, the website.
- **1080 × 1080**: the X and Instagram feeds.

Kinetic type in the grammar of a technical title sequence (crop marks, telemetry, a prompt
bar, a paper form and a stamp), in ADCode's own palette: warm black, cream, and the site's
mint, which is the only colour and only ever means money.

| Time | Scene |
| --- | --- |
| 0–2 s | **Hook, finished on frame 0.** "Get **paid** to code." A green rule draws itself, then the line punches through the lens into a flash. |
| 2–4.3 s | **Build.** Close on the composer: "ADCode, build me a habit tracker" types itself. Enter, the message rises, the agent's steps tick in. |
| 4.3–6.9 s | **The ad.** Pull back to the whole window. A sponsored card (the fictional Acme Cloud) slides in, "+$0.04" pops, and the earnings turn green. "An occasional ad keeps it free." |
| 6.9–10.5 s | **50%.** Whip to a counter running 00% → 50% over a glowing ruler, which breaks into YOU · 50% and ADCODE · 50%. "Half the ad money is yours." |
| 10.5–12.5 s | **The ledger.** A paper form types in the event, what the advertiser paid and your share. A **50% YOURS** stamp slams down. "On a ledger you can audit." |
| 12.5–16 s | **Windows.** The desktop rises in. The Store opens on ADCode's listing; Get, installing, Open; it pins to the taskbar. "Now on the Microsoft Store." |
| 16–20 s | **End card.** The camera dives into the app icon, which pulls back as the end card's tile. ADCode · "Get paid to code." · "Free. Half the ad money is yours." · the official Get it from Microsoft badge · adcode.bluethenics.com. |

```
node marketing/ad-payback/fetch-tools.mjs            # once: ffmpeg and fonts, shared
node marketing/ad-store/render.mjs                   # both cuts, into out/ (~30 min)
node marketing/ad-store/render.mjs --format square   # one cut
node marketing/ad-store/render.mjs --stills 0,8.9,19.5 --format square
node marketing/ad-store/render.mjs --preview         # loop it in a window
node marketing/ad-store/verify.mjs                   # delivery, copy, colour, sound
```

The rules from the earlier ads hold:
- The advertiser is the fictional Acme Cloud.
- No competitor names, no "free AI", and no promise that every prompt pays.
- Amounts are examples. "Example amounts. Earnings vary. Sponsored cards are occasional." stays on screen for the whole spot.
- Windows is drawn in ADCode's palette, not copied: no Windows or Store logos. The only Microsoft artwork is the official badge (`stage/assets/ms-badge-dark.svg`, from get.microsoft.com), which Microsoft provides for promoting Store apps.

How it is made: `stage/cues.js` is the one timing table, read by the picture, the
soundtrack and verify. Scenes are pure functions of `t`. The Electron renderer (shared with
ad-tools) averages up to 32 samples a frame for real motion blur and adds grain in ffmpeg. The
soundtrack is synthesised offline, cue for cue.
