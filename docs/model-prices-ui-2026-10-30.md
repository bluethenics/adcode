# Model pricing presentation — 30 October 2026

The paid-credit model catalogue now has a bordered panel, aligned price columns, company subtitles, connection labels, availability badges, sticky column headers, model/provider search, and All / Direct / OpenRouter filters. Phones use individual price cards instead of a wide table. Price explanations remain available in an expandable footer. Pricing calculations and billing behavior were not changed.

Source: `apps/web/src/app/ai-tokens/ModelPrices.tsx`, `ModelWallet.tsx` and `ai-tokens.css`. The shared production source was updated with these three files only.

Live on https://adcode.bluethenics.com/ai-tokens#wallet as Worker version `cfab62d8-02ca-4440-b748-98d890af3f0c`.

Validation: website TypeScript and the OpenNext production build passed. Browser checks verified all 21 connections, eight direct connections, thirteen OpenRouter connections, combined search/filter results, the empty state and reset, and keyboard focus. Dark and light previews passed at desktop and phone sizes. The live desktop table fits its container without horizontal scrolling; the live 390px layout uses cards without page overflow. Live screenshots are in `output/model-prices-styled-live-2026-10-30.png` and `output/model-prices-styled-mobile-2026-10-30.png`.
