# Posting "Blip" on ADCode's Instagram

Prepared 2 October 2026. Nothing here is posted or paid for until Sinan decides.

## Before you post (blocking)

1. **Open source must be true in public.** The film says "Free & open source" and
   "Apache-2.0". Push `main` and deploy the site first.
2. **The bio link works on a phone.** Use
   `https://adcode.bluethenics.com/versions?utm_source=instagram&utm_campaign=blip`.
   Open it on a phone and check that the Windows and Linux install paths are there.
3. **Check Instagram's own preview.** Upload, then look before publishing: the caption and
   buttons must not cover the hook, the "Get paid to wait." frame or "Link in bio". The film
   keeps critical copy inside x 64–1016, y 220–1410 and clear of the right-hand button rail,
   and verify checks every settled frame against that.

## Files

| File | Use |
|---|---|
| `out/ADCode-Blip-H1-1080x1920.mp4` | Hook 1: "POV: your AI is still thinking…" |
| `out/ADCode-Blip-H2-1080x1920.mp4` | Hook 2: "Your AI is slow. Make it pay you." |
| `out/cover-H1.png`, `out/cover-H2.png` | Covers. Each is frame 0, and the hook sits inside the profile grid's 3:4 crop. |
| `out/contact-sheet-H*.png` | The whole film, one frame a second, for review. |

## Caption

The first line is all most people see before "more", so it repeats the hook's promise.

```
Your AI is trying its best. Now the wait pays you. 💸

ADCode is a free, open-source AI code editor. While you build, it shows an occasional sponsored card - and half the ad money is yours.

Meet the crew: Blip (your AI), Hex, Pip, Bloom, Patch and Quill. 🫶

New in ADCode:
• Open source (Apache-2.0)
• Run 3 agents at once
• Race mode - one task, 3 agents, keep the best

Windows & Linux. Bring your own AI key or local model.
👉 Link in bio

Send this to the friend who's always waiting on their AI 👀

Stat: Stack Overflow Developer Survey 2025 + April 2026 pulse survey. Amounts are examples; earnings vary.

#ADCode #AICoding #VibeCoding #BuildWithAI #DevLife
```

**Pin this comment:** `Which one are you - Hex, Pip, Bloom, Patch or Quill? 👇` It invites
replies, and conversation with the account is a ranking signal. Reply to every comment in the
first hour.

## Upload settings

- **Sound:** keep the original audio, and name it "Blip's theme · ADCode". When someone
  reuses it, the sound page credits ADCode. Do not add music from Instagram's library: it
  replaces the soundtrack and breaks the lip sync.
- **Quality:** turn on *Upload at highest quality* (Settings › Data usage and media quality)
  before the first upload.
- **Overlays:** no extra text, stickers or captions. Everything is already in the picture
  and readable on mute.
- **Cover:** `cover-H1.png` for H1, `cover-H2.png` for H2.

## The test: Trial Reels, then share the winner

1. Post **H1** and **H2** as **Trial Reels**. Trial Reels are shown to non-followers first.
   Use the same caption and post them at the same time on the same day.
2. **Read the results:**
   - Around **24 hours:** skip rate or 3-second hold, and average watch time. These show
     which hook stops the scroll.
   - Around **72 hours:** sends per reach (shares), likes per reach, and profile visits.
     These show which one people pass on.
3. **Share the winner** to followers. Re-post the loser later with a new caption only if it
   won on sends.
4. **Same day:** put the winner in a **Story** with a **link sticker** pointing at the
   `/versions` URL with `utm_campaign=blip-story`. Stories can carry a link and Reels
   cannot.

Treat organic comparisons as directional, because Instagram does not randomise audiences. If
a paid test follows, use Meta's A/B test with only the hook changed. That is a separate
decision and a separate spend.

## What success means

Views are the start, not the goal. Log each of these at 24 h, 72 h and 7 days.

| Stage | Metric | Tells you |
|---|---|---|
| Hook | Skip rate / 3-second hold | Does frame 0 stop the thumb? |
| Story | Average watch time, replays | Does the arc hold to "Get paid to wait."? |
| Spread | Sends per reach, shares | Is it relatable enough to pass on? |
| Intent | Profile visits, link taps | Does interest reach the bio link? |
| Users | `utm_campaign=blip*` visits, install-command copies (`install_copy`) | Did it bring real people to the download? |

The site records only `utm_source` and `utm_campaign`, for visitors who accept analytics,
so these numbers undercount. An install-command copy is a proxy for an install, not proof of
one.

## Why it is built this way

These choices come from what Instagram has said about ranking, and from what worked or
failed in ADCode's earlier ads:

- **Watch time** and **sends per reach** are the signals Instagram's head, Adam Mosseri, has
  named as most important for reaching people who don't follow you.
  ([summary](https://www.dataslayer.ai/blog/instagram-algorithm-2025-complete-guide-for-marketers))
  So the film opens on a pain everyone recognises, stays emotional, and loops.
- **A readable frame 0.** ADCode's boosted X videos lost almost everyone in the first
  seconds. The one whose first frame was a readable offer did best.
- **Named characters with personality.** Duolingo's Duo works because the mascot is a
  character, not a logo, and Mailchimp's Freddie sits at the user's emotional peak (the
  high-five). Here that peak is "It works!".
  ([Adweek](https://www.adweek.com/brand-marketing/duolingo-duo-owl-marketing-strategy/))
- **Original audio and original art.** Instagram favours original content over reposts.
- **[Trial Reels](https://about.fb.com/news/2024/12/trial-reels-try-content-non-followers-first-see-what-perfoms-best/)**
  let ADCode learn from non-followers before showing followers.

None of this guarantees reach. These are the best-supported bets, and the test above is how
ADCode finds out.
