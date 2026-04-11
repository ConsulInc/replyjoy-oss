import { describe, expect, it } from "vitest";

import { allocateThreadCosts } from "./gmail-sync.js";

describe("allocateThreadCosts", () => {
  it("spreads unattributed run cost across all candidate threads", () => {
    const results = allocateThreadCosts({
      candidateThreadIds: ["thread_a", "thread_b"],
      attributedCostByThread: new Map([
        ["thread_a", 0.03],
        ["thread_b", 0.01],
      ]),
      unattributedCostUsd: 0.02,
      decisions: new Map([
        ["thread_a", { decision: "drafted", reason: "Strong match." }],
        ["thread_b", { decision: "skipped", reason: "No reply needed." }],
      ]),
    });

    expect(results.get("thread_a")).toEqual({
      decision: "drafted",
      reason: "Strong match.",
      costUsd: 0.04,
    });
    expect(results.get("thread_b")).toEqual({
      decision: "skipped",
      reason: "No reply needed.",
      costUsd: 0.02,
    });
  });

  it("defaults undecided threads to skipped with the shared review cost", () => {
    const results = allocateThreadCosts({
      candidateThreadIds: ["thread_a", "thread_b"],
      attributedCostByThread: new Map(),
      unattributedCostUsd: 0.03,
      decisions: new Map([["thread_a", { decision: "drafted", reason: "Reply drafted." }]]),
    });

    expect(results.get("thread_a")).toEqual({
      decision: "drafted",
      reason: "Reply drafted.",
      costUsd: 0.015,
    });
    expect(results.get("thread_b")).toEqual({
      decision: "skipped",
      reason: "Reviewed during sync, but no draft was created.",
      costUsd: 0.015,
    });
  });
});
