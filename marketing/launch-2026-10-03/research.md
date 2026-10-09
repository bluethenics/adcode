# ADCode: same-day acquisition evidence

Prepared 3 October 2026; updated 4 October 2026 (Asia/Calcutta). The campaign begun on 3 October continues on 4 October, with the current target of 200 new people who successfully use ADCode on 4 October. This is a planning target, not a promised result. Actual new activated users are unverified; published posts, views, downloads, and signups do not establish that the target has been met. Publishing status belongs in the campaign execution log; this document is research only.

## What successful developer tools actually did

| Example | Evidence | Action for ADCode today |
| --- | --- | --- |
| PostHog / James Hawkins | Started with approximately 10 users from personal networks, onboarded manually, then made deployment self-serve. Its Hacker News launch reached 300 deployments within a couple of days. | Help interested developers complete one actual task; fix installation and key-setup friction before spending all the time on more posts. |
| Supabase / Paul Copplestone and Ant Wilson | Its 2020 alpha launch brought 30,000 website visitors and 1,400 signups over seven days after major HN distribution. | Broad developer distribution can work, but this unusually successful launch is not a reliable daily forecast. |
| Supabase's launch process | Matches the feature to the channel, with implementers explaining what they built. Its founder distinguished short Twitter content, moderate technical depth on Reddit, and deeper technical HN content. | Adapt the explanation and question to each community, give developers technical answers, and follow its current posting rules. Historical channel advice does not override today's restrictions. |
| YC | Recommends launching, recruiting manually, talking to users, and iterating. A small group with a serious need matters more than superficial interest from a large group. | Spend meaningful time answering and onboarding people who respond. Traffic alone does not meet the goal. |

Sources: [PostHog's first 1,000 users](https://newsletter.posthog.com/p/how-we-got-our-first-1000-users), [Supabase alpha postmortem](https://supabase.com/blog/alpha-launch-postmortem), [Supabase launch process](https://supabase.com/blog/supabase-how-we-launch), [Supabase founder's channel explanation](https://news.ycombinator.com/item?id=32412036), [YC's essential advice](https://www.ycombinator.com/blog/ycs-essential-startup-advice/).

These are historical founder reports, not proof that a particular posting cadence or algorithm trick works in October 2026. In particular, Supabase's founder said their attribution was not sophisticated enough to assign growth to one social channel. Do not present memes, follower counts, or reply volume as proven causes of installs.

## Priorities for the remaining day

1. **People already showing interest:** Answer existing replies and installation questions first. Ask the person what they want to build or fix, then help them reach that result. This is the closest application of YC's manual recruitment advice.
2. **X:** One clear demonstration aimed at a specific need: a free desktop editor that works with the developer's own AI key. A short real recording can show folder → edit → terminal → result. Add relevant, useful replies to active conversations; use a product link when it answers the actual question. This is a recommendation, not a guaranteed reach mechanism.
3. **Reddit submissions stopped:** The user reports that Reddit filters are removing their posts. Do not submit further pitches, repost removed material, or switch communities or accounts to bypass those filters. Relevant replies and onboarding remain useful where permitted, but new Reddit promotion is not part of this campaign.
4. **Other sites where the founder already has access:** Check existing developer groups with an explicit showcase channel and an available account. Treat these as qualified distribution experiments, not assured same-day traffic. DEV is excluded from this AI-assisted business-promotion push: its guidelines prohibit AI-assisted or generated articles promoting a business and also prohibit AI-generated comments. A runnable tutorial or disclosure does not remove that restriction. [DEV's AI-content guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev).
5. **Founder-written Show HN:** Potentially valuable for a developer tool people can download and try immediately. Current HN rules prohibit generated text, AI-edited comments, and automated posting. The founder must personally write and submit any HN contribution; do not supply an AI-generated submission or comment for them to paste. No coordinated votes or comments. [HN guidelines](https://news.ycombinator.com/newsguidelines.html), [Show HN guidelines](https://news.ycombinator.com/showhn.html).

Directories, SEO, and unfamiliar accounts requiring setup or review can help later; they are weak foundations for a deadline measured in hours. Do not buy listings or ads without an approved budget.

## The 200-user funnel

Count an activated user as a unique new person who installs, opens a project, and completes one meaningful edit or AI task. If this cannot be measured, report verified downloads or signups separately and say activation is unknown.

Illustrative assumptions, not ADCode measurements or industry benchmarks:

| Scenario | Visit → download | Download → launched | Launched → first task | Visits required for 200 activations |
| --- | ---: | ---: | ---: | ---: |
| Cautious | 10% | 50% | 40% | 10,000 |
| Working plan | 20% | 50% | 50% | 4,000 |
| Strong fit | 30% | 70% | 60% | 1,588 |

Formula: required visits = 200 / (download rate × launch rate × first-task rate), rounded up. A 200-person target likely needs a breakout distribution event, an existing audience, or unusually effective direct recruitment. An increased number of posts alone is not evidence that the target is achievable.

Use a separate campaign link per destination if supported. Record the published URL, time, clicks, downloads, confirmed activations, and questions. After the first response wave, spend the next hour on the channel producing actual installs and the setup problem preventing first use.

## Claims to verify before repeating

- The pasted account audit's follower counts and post views are historical observations, not a fresh account measurement.
- Avoid “source never leaves the machine” without a verified data-flow explanation; cloud AI providers may receive context even when a person supplies their own key.
- Avoid “covers your AI bills,” guaranteed earnings, or payout amounts without measured evidence.
- Describe supported platforms and installation paths from the live release state. The earlier audit may be stale.
- No claim that ADCode is YC-backed or endorsed. “YC-style” here means practical founder-led recruitment and learning.

## Further account and launch examples checked on 4 October

These examples show identifiable publishing choices from established developer-tool teams. They do not establish that those choices caused growth or that copying them will yield 200 users in a day.

| Team and primary evidence | Publishing choice observed | Practical adaptation for ADCode |
| --- | --- | --- |
| **Cursor** — [official social launch post](https://www.linkedin.com/posts/cursorai_cursor-now-controls-its-own-computer-agents-activity-7432136293272207360-4Zou), checked 4 October 2026 | One specific new capability, a product recording showing an actual task, an example that did not work as intended alongside a successful result, and a direct onboarding link. The transcript makes the outcome assessable without reading a long feature list. | For the next original post, record one small real change from open folder to running result, including review of the diff. State OS and provider and direct viewers to the download page. The current illustrated reel should remain labelled as an illustration. Do not imitate Cursor capabilities that ADCode has not verified. |
| **Zed / Max Brunsfeld** — [Windows launch, 15 October 2025](https://zed.dev/blog/zed-for-windows-is-here), plus [Nathan Sobo's AI launch, 20 August 2024](https://zed.dev/blog/zed-ai) | The Windows announcement starts with the usable download, explains platform-specific workflows, and asks for feedback on named areas rather than a generic “thoughts?”. The AI launch walks through creating and then using an extension, with concrete commands and a contribution invitation. | Split the next genuine update by audience: Windows installation from Microsoft Store, or Linux installation and local-model setup. Ask users to report the precise step that blocked their first task, with OS, model/provider and a safe error message. Answer those cases and publish a verified fix when it exists. Do not call an existing platform release “new” merely to create a launch hook. |
| **Lovable / growth team member Henrik** — [official growth retrospective, published 28 January 2025](https://lovable.dev/blog/2025-01-29-zero-to-10m-arr-in-2-months) | The team's retrospective identifies user project sharing on X, LinkedIn and YouTube, hackathons, feature releases, user showcases, partner content, and a Product Hunt launch. This is the team's retrospective explanation, not channel-level attribution data. | After someone completes a real task, ask whether they want to share a short clip or public project and whether ADCode may feature it with credit. Make the result and the person's problem the content. Start with one willing tester and an authentic outcome; do not manufacture testimonials, pay for praise, or launch a contest without a defined budget and terms. |

The strongest common pattern is a clear audience, a real completed task, one usable next step, and a specific feedback loop. For this campaign, verified installs and first-task support are more useful than adding near-identical promotional posts. Record the next support outcome as: source channel → OS/provider → installation completed → first task completed → blocker or fix. Attribution and activation remain unverified until those events are measured or confirmed.

## Launch-day selection and DevHunt timing

Verified 4 October 2026 (Asia/Calcutta). DevHunt launches new cohorts every **Tuesday**, and its upcoming page lists 6 October and 13 October. Its newsletter also runs on Tuesdays. This is a platform schedule, not evidence that Tuesday is universally the highest-traffic day for developer products. [DevHunt upcoming launches](https://devhunt.org/upcoming), [DevHunt FAQ](https://devhunt.org/faq).

The public FAQ describes free launches assigned from a queue, a $19 paid option to choose a week, and a $49 boosted option. The actual India booking screen in this session instead offered **$9 unboosted or $29 boosted for 6 October**, with a free wait of approximately three years. Treat those as the regional options observed at booking, not universal prices. The user selected free. The [public ADCode listing](https://devhunt.org/tool/adcode) now displays **29 January 2030**, also a Tuesday, as its launch date. **The listing is public now; its featured launch is scheduled for 2030.** It must not be counted as an October 2026 featured launch or as evidence of new users.

Product Hunt's official guidance offers no guaranteed best weekday: readiness, competing launches, and authentic engagement matter. It also reports that weekend launches receive 15% more “Visit” button clicks than weekday launches, which does not prove a universal weekend advantage for ADCode. Tuesday is a reasonable preference when preparation and platform availability fit; it is not a supported guarantee of more traffic. [Product Hunt launch guidance](https://www.producthunt.com/launch/preparing-for-launch).
