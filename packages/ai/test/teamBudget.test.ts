import { describe, expect, it } from "vitest";
import {
  createTeamBudget,
  releaseTeamReservation,
  reserveTeamBudget,
  settleTeamReservation,
  type TeamBudgetLedger,
} from "../src/teamBudget.ts";

const budget = (): TeamBudgetLedger =>
  createTeamBudget({
    tokenLimit: 100,
    costMicrosLimit: 1_000,
    agentTokenLimits: { alpha: 70, beta: 60 },
  });

describe("atomic Team budget reservations", () => {
  it("counts concurrent reservations against one parent hard limit", () => {
    const alpha = reserveTeamBudget(budget(), {
      id: "reservation-alpha",
      agentId: "alpha",
      tokens: 60,
      costMicros: 400,
    });
    expect(alpha.ok).toBe(true);
    const beta = reserveTeamBudget(alpha.ledger, {
      id: "reservation-beta",
      agentId: "beta",
      tokens: 50,
      costMicros: 300,
    });

    expect(beta.ok).toBe(false);
    if (beta.ok) throw new Error("expected the team limit to block");
    expect(beta.reason).toBe("team-token-limit");
    expect(beta.ledger).toBe(alpha.ledger);
  });

  it("enforces per-agent allowances independently of the parent reserve", () => {
    const result = reserveTeamBudget(budget(), {
      id: "reservation-alpha",
      agentId: "alpha",
      tokens: 71,
      costMicros: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the agent limit to block");
    expect(result.reason).toBe("agent-token-limit");
  });

  it("settles a conservative reservation and releases its unused capacity", () => {
    const reserved = reserveTeamBudget(budget(), {
      id: "reservation-alpha",
      agentId: "alpha",
      tokens: 60,
      costMicros: 400,
    });
    if (!reserved.ok) throw new Error("expected reservation");
    const settled = settleTeamReservation(reserved.ledger, "reservation-alpha", {
      tokens: 25,
      costMicros: 180,
    });

    expect(settled.usedTokens).toBe(25);
    expect(settled.usedCostMicros).toBe(180);
    expect(settled.reservations).toEqual([]);
    expect(
      reserveTeamBudget(settled, {
        id: "reservation-beta",
        agentId: "beta",
        tokens: 60,
        costMicros: 500,
      }).ok,
    ).toBe(true);
  });

  it("refuses provider usage above its reservation rather than hiding a hard-limit breach", () => {
    const reserved = reserveTeamBudget(budget(), {
      id: "reservation-alpha",
      agentId: "alpha",
      tokens: 60,
      costMicros: 400,
    });
    if (!reserved.ok) throw new Error("expected reservation");

    expect(() =>
      settleTeamReservation(reserved.ledger, "reservation-alpha", {
        tokens: 61,
        costMicros: 400,
      }),
    ).toThrow(/exceeds.*reservation/i);
  });

  it("releases cancelled reservations and rejects duplicate reservation ids", () => {
    const first = reserveTeamBudget(budget(), {
      id: "reservation-alpha",
      agentId: "alpha",
      tokens: 40,
      costMicros: 100,
    });
    if (!first.ok) throw new Error("expected reservation");
    expect(() =>
      reserveTeamBudget(first.ledger, {
        id: "reservation-alpha",
        agentId: "beta",
        tokens: 10,
        costMicros: 10,
      }),
    ).toThrow(/duplicate reservation/i);
    expect(releaseTeamReservation(first.ledger, "reservation-alpha").reservations).toEqual([]);
  });

  it("never admits more than the hard limit across arbitrary-looking interleavings", () => {
    let ledger = createTeamBudget({ tokenLimit: 250, costMicrosLimit: 5_000, agentTokenLimits: {} });
    for (let index = 0; index < 100; index += 1) {
      const result = reserveTeamBudget(ledger, {
        id: `reservation-${String(index)}`,
        agentId: `agent-${String(index % 4)}`,
        tokens: (index * 17) % 43,
        costMicros: (index * 31) % 211,
      });
      if (result.ok) ledger = result.ledger;
      if (index % 3 === 0 && ledger.reservations[0] !== undefined) {
        ledger = releaseTeamReservation(ledger, ledger.reservations[0].id);
      }
      const reservedTokens = ledger.reservations.reduce((sum, one) => sum + one.tokens, 0);
      const reservedCost = ledger.reservations.reduce((sum, one) => sum + one.costMicros, 0);
      expect(ledger.usedTokens + reservedTokens).toBeLessThanOrEqual(ledger.tokenLimit);
      expect(ledger.usedCostMicros + reservedCost).toBeLessThanOrEqual(ledger.costMicrosLimit);
    }
  });
});
