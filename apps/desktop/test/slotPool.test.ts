/**
 * The parallel-agents limit. Every board run and Team role takes a slot before it calls a
 * model, across all runs in the window. The failure that matters is a leaked slot: one that
 * a cancelled or failed run never gives back quietly lowers the limit until restart, and the
 * queue stops draining with nothing on screen to explain why.
 */
import { describe, expect, it } from "vitest";
import { createSlotPool } from "../src/main/slotPool.ts";

describe("slot pool", () => {
  it("never hands out more slots than the limit", () => {
    const pool = createSlotPool(() => 2);
    expect(pool.tryAcquire()).toBe(true);
    expect(pool.tryAcquire()).toBe(true);
    expect(pool.tryAcquire()).toBe(false);
    expect(pool.active()).toBe(2);
  });

  it("serves waiters first-in, first-out as slots free up", async () => {
    const pool = createSlotPool(() => 1);
    pool.tryAcquire();
    const order: string[] = [];
    const first = pool.acquire().then(() => order.push("first"));
    const second = pool.acquire().then(() => order.push("second"));
    expect(pool.waiting()).toBe(2);
    pool.release();
    await first;
    expect(order).toEqual(["first"]);
    pool.release();
    await second;
    expect(order).toEqual(["first", "second"]);
    expect(pool.active()).toBe(1);
  });

  it("lets a waiter behind the queue wait even when a slot is free, so nobody jumps the line", async () => {
    const pool = createSlotPool(() => 1);
    pool.tryAcquire();
    const waiting = pool.acquire();
    expect(pool.tryAcquire()).toBe(false);
    pool.release();
    await waiting;
    expect(pool.active()).toBe(1);
  });

  it("drops an aborted waiter without ever giving it a slot", async () => {
    const pool = createSlotPool(() => 1);
    pool.tryAcquire();
    const controller = new AbortController();
    const cancelled = pool.acquire(controller.signal);
    const next = pool.acquire();
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/i);
    expect(pool.waiting()).toBe(1);
    pool.release();
    await next;
    expect(pool.active()).toBe(1);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const pool = createSlotPool(() => 1);
    pool.tryAcquire();
    const controller = new AbortController();
    controller.abort();
    await expect(pool.acquire(controller.signal)).rejects.toThrow(/cancelled/i);
    expect(pool.waiting()).toBe(0);
  });

  it("follows a raised limit on the next release", async () => {
    let limit = 1;
    const pool = createSlotPool(() => limit);
    pool.tryAcquire();
    const a = pool.acquire();
    const b = pool.acquire();
    limit = 3;
    pool.release();
    await Promise.all([a, b]);
    expect(pool.active()).toBe(2);
  });

  it("never lets active go below zero on an extra release", () => {
    const pool = createSlotPool(() => 1);
    pool.release();
    expect(pool.active()).toBe(0);
    expect(pool.tryAcquire()).toBe(true);
  });
});
