import { describe, expect, it } from "vitest";

import { extractJson } from "./json.js";

describe("extractJson", () => {
  it("parses fenced JSON", () => {
    expect(extractJson<{ action: string }>("```json\n{\"action\":\"finish\"}\n```")).toEqual({
      action: "finish",
    });
  });

  it("extracts the first complete JSON object from surrounding prose", () => {
    expect(
      extractJson<{ action: string; reason: string }>(
        'Here is the result:\n{"action":"finish","reason":"done"}\nThanks.',
      ),
    ).toEqual({
      action: "finish",
      reason: "done",
    });
  });

  it("ignores extra JSON-like content after the first complete object", () => {
    expect(
      extractJson<{ action: string; reason: string }>(
        '{"action":"finish","reason":"done"}\n{"debug":"extra"}',
      ),
    ).toEqual({
      action: "finish",
      reason: "done",
    });
  });

  it("repairs model JSON with unescaped internal quotes in string values", () => {
    expect(
      extractJson<{ action: string; query: string }>(
        '{"action":"search_mailbox","query":"from:me (recruiter OR hiring OR "intro" OR "opportunity")","reason":"Context search"}',
      ),
    ).toEqual({
      action: "search_mailbox",
      query: 'from:me (recruiter OR hiring OR "intro" OR "opportunity")',
      reason: "Context search",
    });
  });

  it("repairs unescaped quotes in fenced JSON content", () => {
    expect(
      extractJson<{ action: string; query: string }>(
        '```json\n{"action":"search_mailbox","query":"label:inbox and ("noreply" OR "hello")","reason":"x"}\n```',
      ),
    ).toEqual({
      action: "search_mailbox",
      query: 'label:inbox and ("noreply" OR "hello")',
      reason: "x",
    });
  });
});
