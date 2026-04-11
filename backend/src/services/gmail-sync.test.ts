import { describe, expect, it, vi } from "vitest";

import {
  buildSearchQuery,
  computeWindowStart,
  hasEligibleInboxLabels,
  parseFromHeader,
} from "./gmail-sync.js";

describe("gmail sync helpers", () => {
  it("adds overlap when resuming from the previous poll time", () => {
    const lastPolledAt = new Date("2026-04-06T10:00:00.000Z");

    const windowStart = computeWindowStart("1d", lastPolledAt);

    expect(windowStart.toISOString()).toBe("2026-04-06T09:58:00.000Z");
  });

  it("builds an inbox query for the inbox with hard filters", () => {
    const query = buildSearchQuery(new Date("2026-04-06T10:00:00.000Z"));

    expect(query).toContain("in:inbox");
    expect(query).toContain("-category:spam");
    expect(query).toContain("-category:social");
    expect(query).toContain("-category:promotions");
    expect(query).toContain("-category:updates");
    expect(query).toContain("-category:forums");
    expect(query).toContain("after:1775469600");
  });

  it("treats inbox mail as eligible when it is not in excluded categories", () => {
    expect(hasEligibleInboxLabels(["INBOX", "UNREAD"])).toBe(true);
  });

  it("rejects excluded categories in the inbox", () => {
    expect(hasEligibleInboxLabels(["INBOX", "CATEGORY_PROMOTIONS"])).toBe(false);
    expect(hasEligibleInboxLabels(["INBOX", "CATEGORY_SOCIAL"])).toBe(false);
    expect(hasEligibleInboxLabels(["INBOX", "CATEGORY_UPDATES"])).toBe(false);
    expect(hasEligibleInboxLabels(["INBOX", "CATEGORY_FORUMS"])).toBe(false);
    expect(hasEligibleInboxLabels(["INBOX", "CATEGORY_SPAM"])).toBe(false);
  });

  it("parses name and email from standard from headers", () => {
    expect(parseFromHeader('"Jordan Lee" <jordan@example.com>')).toEqual({
      name: "Jordan Lee",
      email: "jordan@example.com",
    });
  });

  it("falls back to using the full header value as email when no display name is present", () => {
    expect(parseFromHeader("jordan@example.com")).toEqual({
      name: null,
      email: "jordan@example.com",
    });
  });
});
