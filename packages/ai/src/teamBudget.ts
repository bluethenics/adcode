/** Immutable parent-level reservations for concurrent Team provider requests. */

export interface TeamBudgetInput {
  readonly tokenLimit: number;
  readonly costMicrosLimit: number;
  readonly agentTokenLimits: Readonly<Record<string, number>>;
}

export interface TeamBudgetReservation {
  readonly id: string;
  readonly agentId: string;
  readonly tokens: number;
  readonly costMicros: number;
}

export interface TeamBudgetLedger {
  readonly tokenLimit: number;
  readonly costMicrosLimit: number;
  readonly usedTokens: number;
  readonly usedCostMicros: number;
  readonly agentTokenLimits: Readonly<Record<string, number>>;
  readonly agentUsedTokens: Readonly<Record<string, number>>;
  readonly reservations: readonly TeamBudgetReservation[];
}

const ID = /^[a-z][a-z0-9-]{1,79}$/;

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid`);
  return value;
}

export function createTeamBudget(input: TeamBudgetInput): TeamBudgetLedger {
  const limits: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [agentId, limit] of Object.entries(input.agentTokenLimits)) {
    if (!ID.test(agentId)) throw new Error("Agent budget id is invalid");
    limits[agentId] = positive(limit, "Agent token limit");
  }
  return {
    tokenLimit: positive(input.tokenLimit, "Team token limit"),
    costMicrosLimit: positive(input.costMicrosLimit, "Team cost limit"),
    usedTokens: 0,
    usedCostMicros: 0,
    agentTokenLimits: { ...limits },
    agentUsedTokens: {},
    reservations: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a ledger restored from local persistence before it can authorize another request. */
export function validateTeamBudgetLedger(value: unknown): TeamBudgetLedger {
  if (!isRecord(value) || !isRecord(value["agentTokenLimits"]) || !isRecord(value["agentUsedTokens"])) {
    throw new Error("Persisted Team budget is invalid");
  }
  const base = createTeamBudget({
    tokenLimit: positive(value["tokenLimit"] as number, "Team token limit"),
    costMicrosLimit: positive(value["costMicrosLimit"] as number, "Team cost limit"),
    agentTokenLimits: value["agentTokenLimits"] as Record<string, number>,
  });
  const usedTokens = nonNegative(value["usedTokens"] as number, "Used tokens");
  const usedCostMicros = nonNegative(value["usedCostMicros"] as number, "Used cost");
  const agentUsedTokens: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [agentId, used] of Object.entries(value["agentUsedTokens"])) {
    if (!ID.test(agentId)) throw new Error("Persisted Team budget agent id is invalid");
    agentUsedTokens[agentId] = nonNegative(used as number, "Agent used tokens");
  }
  if (!Array.isArray(value["reservations"])) throw new Error("Persisted Team reservations are invalid");
  let ledger: TeamBudgetLedger = { ...base, usedTokens, usedCostMicros, agentUsedTokens };
  if (usedTokens > ledger.tokenLimit || usedCostMicros > ledger.costMicrosLimit) {
    throw new Error("Persisted Team usage exceeds its hard limit");
  }
  for (const raw of value["reservations"]) {
    if (!isRecord(raw)) throw new Error("Persisted Team reservation is invalid");
    const result = reserveTeamBudget(ledger, {
      id: raw["id"] as string,
      agentId: raw["agentId"] as string,
      tokens: raw["tokens"] as number,
      costMicros: raw["costMicros"] as number,
    });
    if (!result.ok) throw new Error("Persisted Team reservations exceed a hard limit");
    ledger = result.ledger;
  }
  for (const [agentId, used] of Object.entries(agentUsedTokens)) {
    const limit = ledger.agentTokenLimits[agentId];
    if (limit !== undefined && used > limit) throw new Error("Persisted agent usage exceeds its limit");
  }
  return ledger;
}

export type TeamBudgetBlockReason =
  | "team-token-limit"
  | "team-cost-limit"
  | "agent-token-limit";

export type TeamBudgetReservationResult =
  | { readonly ok: true; readonly ledger: TeamBudgetLedger }
  | { readonly ok: false; readonly ledger: TeamBudgetLedger; readonly reason: TeamBudgetBlockReason };

function outstanding(ledger: TeamBudgetLedger): { tokens: number; costMicros: number } {
  return ledger.reservations.reduce(
    (total, reservation) => ({
      tokens: total.tokens + reservation.tokens,
      costMicros: total.costMicros + reservation.costMicros,
    }),
    { tokens: 0, costMicros: 0 },
  );
}

function agentOutstanding(ledger: TeamBudgetLedger, agentId: string): number {
  return ledger.reservations
    .filter((reservation) => reservation.agentId === agentId)
    .reduce((total, reservation) => total + reservation.tokens, 0);
}

export function reserveTeamBudget(
  ledger: TeamBudgetLedger,
  reservation: TeamBudgetReservation,
): TeamBudgetReservationResult {
  if (!ID.test(reservation.id)) throw new Error("Reservation id is invalid");
  if (!ID.test(reservation.agentId)) throw new Error("Reservation agent id is invalid");
  if (ledger.reservations.some((existing) => existing.id === reservation.id)) {
    throw new Error("Duplicate reservation id");
  }
  const tokens = nonNegative(reservation.tokens, "Reservation tokens");
  const costMicros = nonNegative(reservation.costMicros, "Reservation cost");
  const reserved = outstanding(ledger);
  if (ledger.usedTokens + reserved.tokens + tokens > ledger.tokenLimit) {
    return { ok: false, ledger, reason: "team-token-limit" };
  }
  if (ledger.usedCostMicros + reserved.costMicros + costMicros > ledger.costMicrosLimit) {
    return { ok: false, ledger, reason: "team-cost-limit" };
  }
  const agentLimit = ledger.agentTokenLimits[reservation.agentId];
  const agentUsed = ledger.agentUsedTokens[reservation.agentId] ?? 0;
  if (
    agentLimit !== undefined &&
    agentUsed + agentOutstanding(ledger, reservation.agentId) + tokens > agentLimit
  ) {
    return { ok: false, ledger, reason: "agent-token-limit" };
  }
  return {
    ok: true,
    ledger: {
      ...ledger,
      reservations: [...ledger.reservations, { ...reservation, tokens, costMicros }],
    },
  };
}

export function settleTeamReservation(
  ledger: TeamBudgetLedger,
  reservationId: string,
  actual: { readonly tokens: number; readonly costMicros: number },
): TeamBudgetLedger {
  const reservation = ledger.reservations.find((candidate) => candidate.id === reservationId);
  if (reservation === undefined) throw new Error("Team budget reservation was not found");
  const tokens = nonNegative(actual.tokens, "Actual tokens");
  const costMicros = nonNegative(actual.costMicros, "Actual cost");
  if (tokens > reservation.tokens || costMicros > reservation.costMicros) {
    throw new Error("Provider usage exceeds its reservation");
  }
  return {
    ...ledger,
    usedTokens: ledger.usedTokens + tokens,
    usedCostMicros: ledger.usedCostMicros + costMicros,
    agentUsedTokens: {
      ...ledger.agentUsedTokens,
      [reservation.agentId]: (ledger.agentUsedTokens[reservation.agentId] ?? 0) + tokens,
    },
    reservations: ledger.reservations.filter((candidate) => candidate.id !== reservationId),
  };
}

export function releaseTeamReservation(
  ledger: TeamBudgetLedger,
  reservationId: string,
): TeamBudgetLedger {
  if (!ledger.reservations.some((candidate) => candidate.id === reservationId)) {
    throw new Error("Team budget reservation was not found");
  }
  return {
    ...ledger,
    reservations: ledger.reservations.filter((candidate) => candidate.id !== reservationId),
  };
}
