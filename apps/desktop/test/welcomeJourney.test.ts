import { expect, it, vi } from "vitest";
import { showFirstOnboarding } from "../src/renderer/onboarding/welcomeJourney.ts";

it("requires sign-in before opening first-time onboarding", async () => {
  let signIn!: () => void;
  const pending = new Promise<void>(resolve => { signIn = resolve; });
  const account = { wait: () => pending };
  const onboarding = { completed: vi.fn(async () => false), open: vi.fn() };
  const journey = showFirstOnboarding(account, onboarding, async () => {});
  await Promise.resolve();
  expect(onboarding.completed).not.toHaveBeenCalled();
  expect(onboarding.open).not.toHaveBeenCalled();
  signIn();
  await expect(journey).resolves.toBe(true);
  expect(onboarding.open).toHaveBeenCalledOnce();
});

it("skips completed onboarding but still checks the account", async () => {
  const account = { wait: vi.fn(async () => {}) };
  const onboarding = { completed: async () => true, open: vi.fn() };
  const settle = vi.fn(async () => {});
  await expect(showFirstOnboarding(account, onboarding, settle)).resolves.toBe(false);
  expect(account.wait).toHaveBeenCalledOnce();
  expect(settle).not.toHaveBeenCalled();
  expect(onboarding.open).not.toHaveBeenCalled();
});

it("waits for sign-in again if the account changes during the welcome delay", async () => {
  let signIn!: () => void;
  const account = { wait: vi.fn().mockResolvedValueOnce(undefined).mockImplementation(() => new Promise<void>(resolve => { signIn = resolve; })) };
  const onboarding = { completed: async () => false, open: vi.fn() };
  const journey = showFirstOnboarding(account, onboarding, async () => {});
  await vi.waitFor(() => expect(account.wait).toHaveBeenCalledTimes(2));
  expect(onboarding.open).not.toHaveBeenCalled();
  signIn();
  await expect(journey).resolves.toBe(true);
});

it("does not repeat a tour completed by another window during startup", async () => {
  const open = vi.fn();
  const completed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(showFirstOnboarding({ wait: async () => {} }, { completed, open }, async () => {})).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
});
