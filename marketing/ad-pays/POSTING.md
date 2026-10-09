# Posting "Pays You" on X

The last two boosted posts got 58k and 79k impressions. Between them they got 59 unique
video viewers and 147 profile visits, and audience retention near 0% from the first seconds.

The videos were only part of the problem. The rest is how they were run:
- Boost buys impressions and engagements, not visits.
- Neither post had a link.
- The copy was all caps with a typo.
- The product is a desktop app, and most of that audience was on a phone.

This file fixes the parts the video can't.

## 1. Before posting

- [ ] **Make "Open source" true.** Push `main` to GitHub, so the licence shows on the default branch. Then deploy the site, whose pages and terms already say it's open source. The end card says "Open source", so it has to be live first.
- [ ] Check that both install lines below work against the live site.
- [ ] Watch each video once with sound on, on your phone, in the X app.

## 2. Run it as an ad, not a Boost

Create a campaign in X Ads (ads.x.com), not the Boost button on the post. Names in the X Ads interface change; what matters is the goal and the format.

| Setting | Use |
|---|---|
| Objective | **Website traffic**. Use Website conversions instead if the X pixel is on the site. |
| Ad format | **Video website card**: the video with a headline and the link under it. The whole card is clickable. |
| Ads | **Three ads in one ad group**, one per file below, with an equal budget. |
| Audience | English; developer interests and keywords (programming, software engineering, web development, AI coding, vibe coding, JavaScript, Python); follower look-alikes of the developer-tool and programming accounts your users follow |
| Devices | If X offers a desktop placement, try it. ADCode installs on a computer, so a desktop click is worth many phone clicks. |
| Bid | Automatic, to start |

**Picking the winner takes patience.** At your past rate of about 1 visit per 1,000 impressions, 5,000 impressions is only a handful of clicks per ad, and that's noise.
1. **After about 5,000 impressions per ad:** compare the hooks on their **3-second view rate**. That measures the hook itself, and it's meaningful early. Pause any hook that is clearly behind.
2. **After about 30–50 link clicks per ad:** compare **cost per link click**, keep the cheapest, and make the next round's variants against it.

## 3. The three ads

| File | Card headline | Link (each hook has its own campaign tag, which the site records) |
|---|---|---|
| `out/ADCode-PaysYou-H1-1080x1080-60fps.mp4` | This code editor pays you | `https://adcode.bluethenics.com/?utm_source=x&utm_campaign=pays-you-h1` |
| `out/ADCode-PaysYou-H2-1080x1080-60fps.mp4` | Get paid to code | `https://adcode.bluethenics.com/?utm_source=x&utm_campaign=pays-you-h2` |
| `out/ADCode-PaysYou-H3-1080x1080-60fps.mp4` | Your IDE shows ads. You keep half. | `https://adcode.bluethenics.com/?utm_source=x&utm_campaign=pays-you-h3` |

The site's analytics record only `utm_source` and `utm_campaign`, and only for visitors who accept analytics. So treat the site's split as a cross-check. **The main readout is X Ads' per-ad link clicks.**

By default X shows frame 0 as the thumbnail, unless you upload one. Frame 0 of each file is its hook, so don't upload a different thumbnail.

### Post text

Write in sentence case, with no all caps and no 🚨. Proof-read it, and put the link in the post. Swap the first line for each hook.

> This code editor pays you.
>
> ADCode is a free, open-source code editor with AI agents built in (bring your own AI key). An occasional sponsored card keeps it free, and half of that ad money is yours.
>
> Windows & Linux → adcode.bluethenics.com

For H2, the first line is "Get paid to code." For H3, it's "Your IDE shows ads. You keep half."

Keep "bring your own AI key". Without it, "free … with AI agents" reads as free AI, which ADCode doesn't promise.

### First reply (post it yourself, right away)

> Install in one line.
>
> Windows (PowerShell):
> `irm https://adcode.bluethenics.com/install.ps1 | iex`
>
> Linux:
> `curl -fsSL https://adcode.bluethenics.com/install.sh | sh`

## 4. What to read afterwards

- **Ignore "views" and "engagements".** X counts an autoplay as a view, and clicks on the media as engagements.
- **Read these instead:**
  - 3-second view rate
  - link clicks
  - cost per link click
  - visits and downloads on the site by campaign (`pays-you-h1/h2/h3`)
- **A hook that holds people past 3 s but gets no clicks** means the end card or the link is the problem, not the hook.
