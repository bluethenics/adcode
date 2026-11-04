# Included AI capacity and Tagflow access

Free allowance increases from 10 to 100 cost credits daily. Weekly and Monthly increase from 150 to 225; Pro from 600 to 900; Max from 2,400 to 3,000; Unlimited from 5,000 to 7,500. Prices, billing intervals, purchased balances, usage windows, and existing paid-period protection are preserved.

The original sponsored `tagflow-code-27b` route had zero input/output prices. The cost-credit rollout hid it from the catalogue and rejected direct requests as unpriced. A narrow exception restores this exact route on the Tagflow provider, with zero prices and no wallet billing. It consumes no daily or purchased credits and cannot fall back to a metered route without a reservation. Unknown zero-priced routes remain unavailable; verification, account blocks, context limits and provider capacity checks still apply.

The standard live free allowance is updated with the guarded statement in `output/usage-access-config.sql`. It changes only the old 110,000-unit cost configuration to 1,100,000 units and leaves administrator-customized amounts alone. Paid allowances come from the shared API plan definitions. One credit remains 11,000 stored units. Request reservations still cover the maximum quote and release unused amounts after settlement; no provider-cost checks were loosened.

Validation: 272 focused API, pricing, billing, documentation, and request-priority tests passed, including sponsored Tagflow with no daily allowance, unknown-price rejection, purchased-balance preservation and finite subscription budgets. API and website TypeScript checks passed. Production build and public catalogue verification are recorded after rollout below.

The computer-use tool stopped because it could not reliably identify the browser URL. No signed-in browser inference test was performed. Provider capacity remains separate from model access.

A positive remaining balance with too little headroom for the current history and a useful reply now returns HTTP 413/context-length, rather than daily-limit. Released agents already compact and retry that response once, then use their lean-history fallback. Actual exhaustion still uses daily-limit with its refill time. Agent requests shorten only older tool results longer than 6,000 characters to a 4,000-character start plus 1,000-character end and an explicit omission marker. User instructions, tool-call arguments/IDs and the latest tool results remain intact. This reduces repeated input across agent steps; the client transcript stays complete. An additional integration test checks these preservation rules.

Production release `1f4f4338-1580-4515-93ce-9e0faa1a352a` verified the new public plan allowances and sponsored Tagflow entry, with zero input/output credit rates and paid=false. A follow-up release makes the pricing comparison table read its free allowance from the same offer as the headline. The signed-in chat UI could not be tested because browser URL verification stopped computer use. Existing agent request-size and recovery tests (68) pass alongside the 204 API/pricing/documentation checks.

Final deployment: `11ff8e13-68ea-4096-ace6-dccc5002da2c`. Public API, Tagflow zero-credit availability, pricing headline and comparison table verified.
