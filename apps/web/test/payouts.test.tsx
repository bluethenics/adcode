import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EligibilityCard } from "../src/components/PayoutPanel";
import { jumpTarget, ADMIN_NAV } from "../src/components/AdminShell";
import {
  countryName,
  dollarsToPayoutMicros,
  microsToDollarsInput,
} from "../src/lib/payoutOptions";
import type { PayoutsView } from "../src/lib/api";

const render = (node: React.ReactElement): string => renderToStaticMarkup(node);

const rules: PayoutsView["rules"] = [
  { id: "minimum", ok: false, label: "At least $10.00 available", detail: "You have $3.50. $6.50 to go." },
  { id: "verified-email", ok: true, label: "A confirmed email address", detail: "Confirmed as ada@example.com." },
  { id: "account-age", ok: true, label: "Account at least 7 days old", detail: "Opened 30 days ago." },
  { id: "payout-details", ok: false, label: "Payout details on file", detail: "Tell us where the money goes." },
  { id: "no-pending", ok: true, label: "No request already in progress", detail: "Nothing waiting on us." },
];

const view: PayoutsView = {
  minMicros: "10000000",
  availableMicros: "3500000",
  pendingMicros: "0",
  lifetimeMicros: "3500000",
  eligible: false,
  rules,
  profile: null,
  withdrawals: [],
};

describe("the eligibility checklist", () => {
  /*
   * The point of the whole screen. A bare "not eligible" sends somebody to support to ask
   * why; showing the rule they failed *and* the ones they passed answers it in place. So
   * the count of rendered rows is exactly the count of rules, whatever their verdict.
   */
  it("shows every rule, met and unmet alike", () => {
    const markup = render(<EligibilityCard view={view} />);
    for (const rule of rules) expect(markup).toContain(rule.label);
    expect([...markup.matchAll(/<li /g)]).toHaveLength(rules.length);
  });

  it("carries the server's own explanation rather than restating the rule", () => {
    expect(render(<EligibilityCard view={view} />)).toContain("$6.50 to go");
  });

  it("marks each row so the state is visible and announced, not only coloured", () => {
    const markup = render(<EligibilityCard view={view} />);
    expect(markup).toContain('data-ok="false"');
    expect(markup).toContain('data-ok="true"');
    expect(markup).toContain("Not met");
  });

  it("says how many are left when it cannot pay yet", () => {
    expect(render(<EligibilityCard view={view} />)).toContain("3 of 5 conditions met");
  });

  it("leads with the amount once every rule passes", () => {
    const ready: PayoutsView = {
      ...view,
      eligible: true,
      availableMicros: "24500000",
      rules: rules.map((rule) => ({ ...rule, ok: true })),
    };
    const markup = render(<EligibilityCard view={ready} />);
    expect(markup).toContain("You can withdraw");
    expect(markup).toContain("$24.50");
  });

  it("explains a held balance rather than letting it look like money that vanished", () => {
    const holding: PayoutsView = { ...view, pendingMicros: "20000000" };
    expect(render(<EligibilityCard view={holding} />)).toContain("$20.00");
  });
});

describe("the admin jump box", () => {
  it("routes each kind of id to the screen that shows it", () => {
    expect(jumpTarget("wd-42")).toBe("/admin/money?q=wd-42");
    expect(jumpTarget("rep-9")).toBe("/admin/review?tab=feedback&q=rep-9");
    expect(jumpTarget("adv-3")).toBe("/admin/money?tab=advertisers&q=adv-3");
    expect(jumpTarget("camp-3")).toBe("/admin/money?tab=advertisers&q=camp-3");
  });

  it("sends anything else to People, where most pasted strings belong", () => {
    expect(jumpTarget("ada@example.com")).toBe("/admin/people?q=ada%40example.com");
    expect(jumpTarget("gGx8kQ2")).toBe("/admin/people?q=gGx8kQ2");
  });

  it("does nothing on an empty box", () => {
    expect(jumpTarget("   ")).toBeNull();
  });
});

describe("the admin rail", () => {
  /*
   * The panel had nine destinations and the complaint was that it took too much room to
   * say too little. Six is the number that fits without a scroller at any width this
   * site supports; this fails if a tenth ever gets added without that being reconsidered.
   */
  it("stays at six destinations", () => {
    expect(ADMIN_NAV.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/review",
      "/admin/money",
      "/admin/people",
      "/admin/content",
      "/admin/tools",
    ]);
  });

  it("counts the two queues that can block somebody else", () => {
    const counts = {
      creativesWaiting: 2,
      withdrawalsPending: 3,
      reportsOpen: 4,
      advertisers: 9,
      noticesActive: 1,
      pendingWithdrawalMicros: "0",
    };
    const badged = ADMIN_NAV.filter((item) => item.badge !== undefined);
    expect(badged.map((item) => item.href)).toEqual(["/admin/review", "/admin/money"]);
    expect(badged.map((item) => item.badge?.(counts))).toEqual([6, 3]);
  });
});

describe("money in and out of the amount box", () => {
  it("takes what people actually type", () => {
    expect(dollarsToPayoutMicros("12.34")).toBe("12340000");
    expect(dollarsToPayoutMicros("$12")).toBe("12000000");
    expect(dollarsToPayoutMicros("  7.5 ")).toBe("7500000");
  });

  it("refuses a fraction of a cent, which a bank cannot move", () => {
    expect(dollarsToPayoutMicros("12.345")).toBeNull();
  });

  it("refuses anything that is not an amount", () => {
    expect(dollarsToPayoutMicros("")).toBeNull();
    expect(dollarsToPayoutMicros("-5")).toBeNull();
    expect(dollarsToPayoutMicros("1e6")).toBeNull();
  });

  it("rounds the prefilled amount down, never up past the balance", () => {
    // 12.349999 dollars: offering 12.35 would be offering money that is not there.
    expect(microsToDollarsInput("12349999")).toBe("12.34");
    expect(microsToDollarsInput("0")).toBe("0.00");
  });

  it("names a country rather than showing a code to type back in", () => {
    expect(countryName("GB")).toBe("United Kingdom");
  });

  it("falls back to the code rather than throwing on one it cannot name", () => {
    // `Intl.DisplayNames` throws a RangeError on a structurally invalid code, and this
    // runs during static generation as well as in the browser - a throw there fails the
    // build for a value that only ever decides a label.
    expect(countryName("nope")).toBe("nope");
  });
});
