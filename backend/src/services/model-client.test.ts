import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@google/genai";

const generateContentMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  FunctionCallingConfigMode: {
    ANY: "ANY",
  },
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    NUMBER: "NUMBER",
  },
  GoogleGenAI: class {
    models = {
      generateContent: generateContentMock,
    };
  },
}));

vi.mock("../lib/env.js", () => ({
  env: {
    GEMINI_API_KEY: "gemini-test-key", // pragma: allowlist secret
  },
}));

describe("model client", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats Gemini requests using the selected model and parses JSON content", async () => {
    generateContentMock.mockResolvedValue({
      text: '{"action":"finish","reason":"gemini"}',
      usageMetadata: undefined,
    });

    const { askModel } = await import("./model-client.js");
    const result = await askModel<{ action: string; reason: string }>({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      system: "system prompt",
      prompt: "user prompt",
    });

    expect(result).toEqual({ action: "finish", reason: "gemini" });
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: "user prompt" }] }],
        config: expect.objectContaining({
          systemInstruction: "system prompt",
        }),
      }),
    );
  });

  it("passes structured JSON schema for Gemini when provided", async () => {
    generateContentMock.mockResolvedValue({
      text: '{"action":"finish","reason":"done"}',
      usageMetadata: undefined,
    });

    const { askModelWithUsage } = await import("./model-client.js");
    const result = await askModelWithUsage<{ action: string; reason: string }>({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      system: "system prompt",
      prompt: "user prompt",
      responseSchema: {
        name: "agent_action",
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["finish"] },
            reason: { type: "string" },
          },
          required: ["action", "reason"],
          additionalProperties: false,
        },
      },
    });

    const request = generateContentMock.mock.calls[0]?.[0] as {
      config?: {
        responseMimeType?: string;
        responseJsonSchema?: unknown;
      };
    };

    expect(result.data).toEqual({ action: "finish", reason: "done" });
    expect(request.config?.responseMimeType).toBe("application/json");
    expect(request.config?.responseJsonSchema).toMatchObject({
      type: "object",
      properties: { action: { type: "string", enum: ["finish"] } },
    });
  });

  it("formats transcript-style Gemini requests with system instruction and max output tokens", async () => {
    generateContentMock.mockResolvedValue({
      text: '{"action":"finish","reason":"done"}',
      usageMetadata: undefined,
    });

    const { askModelWithUsage } = await import("./model-client.js");
    await askModelWithUsage<{ action: string; reason: string }>({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      system: "system prompt",
      messages: [
        { role: "user", content: "first user message" },
        { role: "assistant", content: '{"action":"read_thread","threadId":"abc","reason":"inspect"}' },
        { role: "user", content: '{"tool":"read_thread","ok":true}' },
      ],
      maxOutputTokens: 123,
    });

    const request = generateContentMock.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config?: {
        systemInstruction?: string;
        maxOutputTokens?: number;
      };
    };

    expect(request.config?.systemInstruction).toBe("system prompt");
    expect(request.contents).toEqual([
      { role: "user", parts: [{ text: "first user message" }] },
      {
        role: "model",
        parts: [{ text: '{"action":"read_thread","threadId":"abc","reason":"inspect"}' }],
      },
      { role: "user", parts: [{ text: '{"tool":"read_thread","ok":true}' }] },
    ]);
    expect(request.config?.maxOutputTokens).toBe(123);
  });

  it("formats Gemini function-calling requests and returns the function call", async () => {
    generateContentMock.mockResolvedValue({
      functionCalls: [
        {
          id: "call_123",
          name: "search_mailbox",
          args: {
            query: "Gmail agent",
            maxResults: 5,
            reason: "Find prior context.",
          },
        },
      ],
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "call_123",
                  name: "search_mailbox",
                  args: {
                    query: "Gmail agent",
                    maxResults: 5,
                    reason: "Find prior context.",
                  },
                },
                thoughtSignature: "sig_123",
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    });

    const { askGeminiFunctionCallWithUsage } = await import("./model-client.js");
    const result = await askGeminiFunctionCallWithUsage({
      model: "gemini-3-flash-preview",
      system: "system prompt",
      contents: [{ role: "user", parts: [{ text: "inspect this thread" }] }],
      functionDeclarations: [
        {
          name: "search_mailbox",
          description: "Search mailbox",
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING },
            },
            required: ["query"],
          },
        },
      ],
      allowedFunctionNames: ["search_mailbox"],
      maxOutputTokens: 321,
    });

    const request = generateContentMock.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
      config?: {
        systemInstruction?: string;
        maxOutputTokens?: number;
        tools?: Array<{ functionDeclarations?: Array<{ name: string }> }>;
        toolConfig?: {
          functionCallingConfig?: {
            mode?: string;
            allowedFunctionNames?: string[];
          };
        };
      };
    };

    expect(result.functionCall).toEqual({
      id: "call_123",
      name: "search_mailbox",
      args: {
        query: "Gmail agent",
        maxResults: 5,
        reason: "Find prior context.",
      },
    });
    expect(result.content).toEqual({
      role: "model",
      parts: [
        {
          functionCall: {
            id: "call_123",
            name: "search_mailbox",
            args: {
              query: "Gmail agent",
              maxResults: 5,
              reason: "Find prior context.",
            },
          },
          thoughtSignature: "sig_123",
        },
      ],
    });
    expect(request.contents).toEqual([{ role: "user", parts: [{ text: "inspect this thread" }] }]);
    expect(request.config?.systemInstruction).toBe("system prompt");
    expect(request.config?.tools?.[0]?.functionDeclarations?.[0]?.name).toBe("search_mailbox");
    expect(request.config?.toolConfig?.functionCallingConfig).toEqual({
      mode: "ANY",
      allowedFunctionNames: ["search_mailbox"],
    });
    expect(request.config?.maxOutputTokens).toBe(321);
  });

  it("formats structured agent prompts for trace readability", async () => {
    const { formatPromptForTrace } = await import("./model-client.js");

    const formatted = formatPromptForTrace(
      JSON.stringify({
        objective: "Review inbox threads",
        candidates: [{ gmailThreadId: "thread_123", subject: "Hello" }],
        inspectedThreadIds: ["thread_123"],
        contextMessagesRead: 1,
        contextMessagesRemaining: 29,
        draftedThreadIds: [],
        notes: [
          {
            kind: "mailbox_search",
            query: "in:sent hello",
            reason: "Find prior examples.",
            results: [
              {
                messageId: "msg_123",
                snippet:
                  "This is a long snippet that should still be readable in LangSmith instead of showing escaped JSON blobs.",
              },
            ],
          },
        ],
      }),
    );

    expect(formatted).toContain("## Objective");
    expect(formatted).toContain("## Candidates");
    expect(formatted).toContain("## State");
    expect(formatted).toContain("## Notes");
    expect(formatted).toContain('"kind": "mailbox_search"');
    expect(formatted).not.toContain('\\"messageId\\"');
  });

  it("retries transient Gemini failures and eventually succeeds", async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error("Gemini error: 503 service unavailable"))
      .mockResolvedValueOnce({
        text: '{"action":"finish","reason":"retried"}',
        usageMetadata: undefined,
      });

    const { askModel } = await import("./model-client.js");
    const result = await askModel<{ action: string; reason: string }>({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      system: "system prompt",
      prompt: "user prompt",
    });

    expect(result).toEqual({ action: "finish", reason: "retried" });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting retries", async () => {
    generateContentMock.mockRejectedValue(new Error("Gemini error: 500 temporary failure"));

    const { askModelWithUsage } = await import("./model-client.js");
    await expect(
      askModelWithUsage<{ action: string; reason: string }>({
        provider: "gemini",
        model: "gemini-3-flash-preview",
        system: "system prompt",
        prompt: "user prompt",
      }),
    ).rejects.toThrow("Model call failed after 3 attempts");

    expect(generateContentMock).toHaveBeenCalledTimes(3);
  });
});
