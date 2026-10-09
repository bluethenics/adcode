# Blip — "Get paid to wait." (Instagram Reel)

A 29-second Reel for ADCode's Instagram, 1080 × 1920, 30 fps, H.264 + AAC at −14 LUFS,
in two variants that differ only in the opening line. It stars ADCode's own agent mascots
and builds an emotional story around a relatable pain: waiting on your AI.

- **H1:** "POV: your AI is still thinking…"
- **H2:** "Your AI is slow. Make it pay you."

See [POSTING.md](POSTING.md) for the caption, the Trial Reels test and what to measure.

## The cast

The shapes and colours are the app's own, from `starterAgents.ts`, `agentMascot.ts` and
`agents.css`. The faces are the app's moods, plus two the film adds in the same line style:
"strain" (`> <`) and "wow". The names are proposals for ADCode's mascot cast.

| Name | Agent | Look | Personality |
|---|---|---|---|
| **Blip** | your AI | blue circle | Tries *so* hard, sweats, quietly adores you |
| **Hex** | Reviewer | violet hexagon | Squints at everything, secretly proud of you |
| **Pip** | Tester | green capsule | Won't relax until it's green |
| **Bloom** | UI polish | pink cloud | Can't walk past a crooked button |
| **Patch** | Bug fixer | coral drop | Runs toward the fire |
| **Quill** | Docs writer | amber egg | Explains it kindly, twice |

## Storyboard

The lighting carries the feeling: lonely 2 a.m. blue, then gold, then a bright stage, then a
cozy night.

| Time | Beat | On screen |
|---|---|---|
| 0–2 | **Hook** (frame 0 is the cover) | Blip, straining, holds up a "Thinking… 99%" card. The hook line is readable before anything moves. |
| 2–4 | **The wait** | Hard cuts: the coffee goes cold, the clock spins, a doomscroll. "Every. / Single. / Prompt." |
| 4–5.4 | **Empathy** | Back to Blip, still straining. "(it's trying its best)" |
| 5.4–8.4 | **Real AI fact** | A card slams down: developers using AI agents, 31% (2025) → 59% (April 2026), "nearly 2×". Source on screen. "That's a lot of waiting." |
| 8.4–11.2 | **The idea** | The app's "!" badge. "What if the wait… paid you?" A sponsored card (fictional Acme Cloud) drops a coin that splits in half. |
| 11.2–13.2 | **The drop** | Night turns gold. "Get paid to wait." "Half the ad money is yours." "+$0.04 · you" / "+$0.04 · ADCode", with the small print on screen. |
| 13.2–16.2 | **Meet the crew** | "Build with AI." Each mascot lands centre stage with its name and role. |
| 16.2–17.7 | **Build** | A page builds in a labelled illustration. Each agent does its job: headline, review, "12 tests passed", the button's polish, the bug squashed, the docs. |
| 17.7–19.2 | **The peak** | "It works!" Confetti, and everyone jumps. |
| 19.2–23.7 | **New in ADCode** | Open source (Apache-2.0), run 3 agents at once, race mode. |
| 23.7–25.7 | **Close** | Done, 100%. The coffee is warm again. Blip, blushing: "Thanks for waiting." |
| 25.7–28.5 | **End card** | ADCode · Build with AI. · Get paid to wait. · Free & open source · Windows & Linux · **Link in bio** · small print. |
| 28.5–29 | **Loop** | The end card flicks up like the next Reel and frame 0 lands, so a replay is seamless. |

## Sound

The music is original and synthesised offline from the cue table, so every hit lands on its
frame. The mascots speak in babble, one pitch each, and each mouth opens on its own
syllables. Under "Get paid to wait." four notes (E G A C) act as a sonic logo, and they come
back on the end card. A silent beat comes before the "!". Everything reads with the sound
off too.

## Claims, and where they come from

- **"Half the ad money is yours."** README: "Half of what an advertiser pays for a view is
  credited to you."
- **"Occasional sponsored card."** Cards arrive while you work. The default is at most one
  every 30 minutes and 8 a day (`packages/help/src/entries/ads.ts`). So the film shows one
  card during one wait, never one per prompt.
- **"+$0.04"** is an example amount. The small print sits on screen with every money claim,
  and verify enforces this.
- **Acme Cloud** is a fictional advertiser.
- **"Free & open source", "Apache-2.0".** The licence is Apache-2.0 (CHANGELOG, Unreleased).
  Before posting, `main` must be pushed and the site deployed.
- **"Run 3 agents at once", "Race mode", "12 tests passed".** The first two are from 2.1.0
  (several agents at once, three by default; race mode keeps the best). The page build is
  labelled *Illustration*.
- **31% → 59%.** Stack Overflow Developer Survey 2025 and its April 2026 pulse survey, as
  [reported by Stack Overflow on 30 Sep 2026](https://stackoverflow.blog/2026/09/30/getting-ready-for-2026-results-a-look-back-on-developer-survey-findings).
- **"Windows & Linux", "Bring your own AI key or local model."** README.

## Commands

From the repository root:

```
node marketing/ad-payback/fetch-tools.mjs        # once: ffmpeg and fonts, shared
node marketing/ad-blip/render.mjs                # both hooks → out/ (~8 min each)
node marketing/ad-blip/verify.mjs                # delivery, copy, safe-zone and loop checks
node marketing/ad-blip/render.mjs --stills 0,11.9,27.4   # review frames only, seconds
node marketing/ad-blip/render.mjs --preview      # loop it in a window
```

`stage/cues.js` is the only timing table. The picture, the soundtrack and verify all read it,
including the babble syllables the mouths move to.

- `stage/film.js` draws each scene as a pure function of time.
- `stage/mascot.js` is the character rig.
- `stage/props.js` holds the sets.
- `stage/audio.js` is the score.

Motion blur happens in the page: each frame averages up to 32 sub-frame drawings when it
moves fast. Frames are read straight from the canvas, because on Windows a hidden window
is clamped to the screen's height. Never run two renders at once.
