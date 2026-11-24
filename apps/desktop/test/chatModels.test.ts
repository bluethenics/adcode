import { describe, expect, it } from "vitest";
import { chatRoute, createModelChoiceWatch, sameChoice, type ChatRouteDeps } from "../src/main/chatModels.ts";

/**
 * Reported for 2.6.5: "there is an issue when I try to use new, different models in two
 * different chats." The model was one setting, so a choice made in chat B moved chat A too.
 */
function deps(chosen: { provider: string; model: string }, connections: readonly { id: string; model: string }[] = []): ChatRouteDeps {
  return {
    chosenLast: () => chosen,
    resolve: (provider, model) => connections.find((one) => one.id === provider)?.model ?? model,
    exists: (provider) => !provider.startsWith("connection-") || connections.some((one) => one.id === provider),
  };
}

describe("which model a chat talks to", () => {
  const alpha = { provider: "tagflow", model: "tagflow-code-27b" };
  const beta = { provider: "openrouter", model: "anthropic/claude-sonnet" };

  it("keeps a chat on its own model after another chat chooses a different one", () => {
    const chatA = { model: alpha };
    // Chat B chose Beta: that is now the model chosen last.
    expect(chatRoute(chatA, deps(beta))).toEqual(alpha);
  });

  it("gives a chat that has not talked to a model yet the one chosen last", () => {
    expect(chatRoute({}, deps(beta))).toEqual(beta);
    expect(chatRoute(null, deps(alpha))).toEqual(alpha);
  });

  it("sends a connection's own model, as it is now", () => {
    const connections = [{ id: "connection-paid", model: "beta-v2" }];
    expect(chatRoute({ model: { provider: "connection-paid", model: "beta-v1" } }, deps(alpha, connections))).toEqual({ provider: "connection-paid", model: "beta-v2" });
  });

  it("falls back to the model chosen last when the chat's connection was deleted", () => {
    expect(chatRoute({ model: { provider: "connection-gone", model: "x" } }, deps(alpha))).toEqual(alpha);
  });

  it("compares choices by provider and model", () => {
    expect(sameChoice(alpha, { ...alpha })).toBe(true);
    expect(sameChoice(alpha, beta)).toBe(false);
    expect(sameChoice(alpha, { provider: "tagflow", model: "other" })).toBe(false);
    expect(sameChoice(undefined, alpha)).toBe(false);
  });
});

describe("noticing a model being chosen", () => {
  it("takes the settings it first sees as the baseline, then reports each different choice once", () => {
    const watch = createModelChoiceWatch();
    expect(watch.changed("tagflow", "")).toBe(false);
    // Another setting changed: the model did not.
    expect(watch.changed("tagflow", "")).toBe(false);
    // The picker writes the provider, then the model: two choices, each noticed.
    expect(watch.changed("connection-paid", "")).toBe(true);
    expect(watch.changed("connection-paid", "beta")).toBe(true);
    expect(watch.changed("connection-paid", "beta")).toBe(false);
  });

  it("treats a missing setting as empty", () => {
    const watch = createModelChoiceWatch();
    expect(watch.changed(undefined, undefined)).toBe(false);
    expect(watch.changed("", "")).toBe(false);
  });

  it("takes a seed as the baseline only when nothing has been seen yet", () => {
    const watch = createModelChoiceWatch();
    watch.seed("tagflow", "");
    expect(watch.changed("connection-paid", "beta")).toBe(true);
    // A late seed - the settings file read after a choice was already noticed - changes nothing.
    watch.seed("tagflow", "");
    expect(watch.changed("connection-paid", "beta")).toBe(false);
  });
});
