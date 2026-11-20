/**
 * The service keeps its own copy of the vocabulary (spec D1: a server that imported the
 * client's types could not catch a contract mismatch). This is where the two are compared,
 * from the client's side, since the service may not import from `packages/`.
 */
import { describe, expect, it } from "vitest";
import * as api from "@adcode/api/src/retention.ts";
import { CHURN_REASONS, EVENT_CODES, FRICTION_EVENTS, FUNNEL_STEPS, RETENTION_EVENTS, SILENT_DAY_CHOICES, VERSION } from "@adcode/retention";

describe("the service's copy of the retention vocabulary", () => {
  it("names the same events, codes and reasons", () => {
    expect([...api.RETENTION_EVENTS]).toEqual([...RETENTION_EVENTS]);
    expect([...api.FUNNEL_STEPS]).toEqual([...FUNNEL_STEPS]);
    expect([...api.FRICTION_EVENTS]).toEqual([...FRICTION_EVENTS]);
    expect(api.EVENT_CODES).toEqual(EVENT_CODES);
    expect(api.VERSION.source).toBe(VERSION.source);
    expect([...api.CHURN_REASONS]).toEqual([...CHURN_REASONS]);
    expect([...api.SILENT_DAY_CHOICES]).toEqual([...SILENT_DAY_CHOICES]);
  });
});
