import { beforeEach, describe, expect, it, vi } from "vitest";

const { askGeminiFunctionCallWithUsage } = vi.hoisted(() => ({
  askGeminiFunctionCallWithUsage: vi.fn(),
}));

vi.mock("./model-client.js", () => ({
  askGeminiFunctionCallWithUsage,
}));

import { runAutonomousAgent, type Candidate } from "./gmail-sync.js";

describe("runAutonomousAgent", () => {
  beforeEach(() => {
    askGeminiFunctionCallWithUsage.mockReset();
  });

  it("can search mailbox history and read prior messages before drafting", async () => {
    const candidates: Candidate[] = [
      {
        gmailThreadId: "thread_123",
        gmailHistoryId: "history_123",
        subject: "Pricing question",
        snippet: "Can you help with pricing?",
        fromEmail: "alex@example.com",
        fromName: "Alex",
        latestMessageAt: "2026-04-07T10:00:00.000Z",
        latestMessageId: "msg_current",
        hasUnread: true,
      },
    ];
    const readThread = vi
      .fn()
      .mockResolvedValue({
        threadId: "thread_123",
        snippet: "Current thread",
        messages: [
          {
            gmailMessageId: "msg_current",
            date: "2026-04-07T10:00:00.000Z",
            from: "Alex <alex@example.com>",
            to: "me@example.com",
            subject: "Pricing question",
            messageId: "<msg_current@example.com>",
            references: null,
            text: "Can you help with pricing?",
          },
        ],
      });
    const searchMailbox = vi.fn().mockResolvedValue([
      {
        messageId: "msg_prior",
        threadId: "thread_prior",
        date: "2026-03-30T09:00:00.000Z",
        from: "me@example.com",
        to: "Alex <alex@example.com>",
        subject: "Re: Pricing question",
        snippet: "Thanks Alex, here is our usual structure.",
        labelIds: ["SENT"],
      },
    ]);
    const searchAttachments = vi.fn().mockResolvedValue([
      {
        messageId: "msg_attachment",
        attachmentId: "att_123",
        filename: "pricing.pdf",
        mimeType: "application/pdf",
        size: 2048,
        threadId: "thread_prior",
        date: "2026-03-30T09:00:00.000Z",
        from: "me@example.com",
        subject: "Re: Pricing question",
      },
    ]);
    const readMessage = vi.fn().mockResolvedValue({
      messageId: "msg_prior",
      threadId: "thread_prior",
      date: "2026-03-30T09:00:00.000Z",
      from: "me@example.com",
      to: "Alex <alex@example.com>",
      subject: "Re: Pricing question",
      snippet: "Thanks Alex, here is our usual structure.",
      labelIds: ["SENT"],
      text: "Thanks Alex, happy to help. Here is the structure we usually recommend...",
      attachments: [],
    });

    askGeminiFunctionCallWithUsage
      .mockResolvedValueOnce({
        functionCall: {
          name: "read_thread",
          args: {
            threadId: "thread_123",
            reason: "Inspect the current request first.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "read_thread", args: { threadId: "thread_123", reason: "Inspect the current request first." } } }] },
        estimatedCostUsd: 0.01,
      })
      .mockResolvedValueOnce({
        functionCall: {
          name: "search_mailbox",
          args: {
            query: "in:sent alex@example.com pricing",
            maxResults: 3,
            reason: "Find similar past replies to match the user's style.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "search_mailbox", args: { query: "in:sent alex@example.com pricing", maxResults: 3, reason: "Find similar past replies to match the user's style." } } }] },
        estimatedCostUsd: 0.02,
      })
      .mockResolvedValueOnce({
        functionCall: {
          name: "read_message",
          args: {
            messageId: "msg_prior",
            reason: "Use this prior sent reply as a style reference.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "read_message", args: { messageId: "msg_prior", reason: "Use this prior sent reply as a style reference." } } }] },
        estimatedCostUsd: 0.03,
      })
      .mockResolvedValueOnce({
        functionCall: {
          name: "search_attachments",
          args: {
            query: "filename:pricing.pdf in:sent alex@example.com",
            maxResults: 3,
            reason: "Find the same pricing attachment used before.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "search_attachments", args: { query: "filename:pricing.pdf in:sent alex@example.com", maxResults: 3, reason: "Find the same pricing attachment used before." } } }] },
        estimatedCostUsd: 0.01,
      })
      .mockResolvedValueOnce({
        functionCall: {
          name: "create_draft",
          args: {
            threadId: "thread_123",
            draft: "Hi Alex,\n\nHappy to help. Here is the pricing structure that usually makes sense...\n",
            attachments: [
              {
                messageId: "msg_attachment",
                attachmentId: "att_123",
                filename: "pricing.pdf",
              },
            ],
            reason: "This matches the user's usual concise and helpful tone.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "create_draft", args: { threadId: "thread_123", draft: "Hi Alex,\n\nHappy to help. Here is the pricing structure that usually makes sense...\n", attachments: [{ messageId: "msg_attachment", attachmentId: "att_123", filename: "pricing.pdf" }], reason: "This matches the user's usual concise and helpful tone." } } }] },
        estimatedCostUsd: 0.04,
      });

    const result = await runAutonomousAgent({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      draftingRules: ["Draft concise, warm, useful replies."],
      candidates,
      readThread,
      searchMailbox,
      searchAttachments,
      readMessage,
    });

    expect(searchMailbox).toHaveBeenCalledWith("in:sent alex@example.com pricing", 3);
    expect(searchAttachments).toHaveBeenCalledWith("filename:pricing.pdf in:sent alex@example.com", 3);
    expect(readMessage).toHaveBeenCalledWith("msg_prior");
    expect(result.drafted.get("thread_123")).toEqual({
      draft: "Hi Alex,\n\nHappy to help. Here is the pricing structure that usually makes sense...\n",
      reason: "This matches the user's usual concise and helpful tone.",
      thread: {
        threadId: "thread_123",
        snippet: "Current thread",
        messages: [
          {
            gmailMessageId: "msg_current",
            date: "2026-04-07T10:00:00.000Z",
            from: "Alex <alex@example.com>",
            to: "me@example.com",
            subject: "Pricing question",
            messageId: "<msg_current@example.com>",
            references: null,
            text: "Can you help with pricing?",
          },
        ],
      },
      attachments: [
        {
          messageId: "msg_attachment",
          attachmentId: "att_123",
          filename: "pricing.pdf",
        },
      ],
    });
    expect(result.threadResults.get("thread_123")).toEqual({
      decision: "drafted",
      reason: "This matches the user's usual concise and helpful tone.",
      costUsd: 0.11,
    });
    expect(result.totalCostUsd).toBe(0.11);
  });

  it("caps mailbox context reads at thirty messages", async () => {
    const readThread = vi.fn();
    const searchMailbox = vi.fn();
    const searchAttachments = vi.fn();
    const readMessage = vi.fn().mockImplementation(async (messageId: string) => ({
      messageId,
      threadId: `thread_${messageId}`,
      date: "2026-04-07T10:00:00.000Z",
      from: "me@example.com",
      to: "person@example.com",
      subject: `Subject ${messageId}`,
      snippet: `Snippet ${messageId}`,
      labelIds: ["SENT"],
      text: `Body ${messageId}`,
      attachments: [],
    }));

    for (let index = 0; index < 31; index += 1) {
      askGeminiFunctionCallWithUsage.mockResolvedValueOnce({
        functionCall: {
          name: "read_message",
          args: {
            messageId: `msg_${index}`,
            reason: `Inspect prior message ${index}.`,
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "read_message", args: { messageId: `msg_${index}`, reason: `Inspect prior message ${index}.` } } }] },
        estimatedCostUsd: 0.001,
      });
    }
    askGeminiFunctionCallWithUsage.mockResolvedValueOnce({
      functionCall: {
        name: "finish",
        args: {
          reason: "Done.",
        },
      },
      content: { role: "model", parts: [{ functionCall: { name: "finish", args: { reason: "Done." } } }] },
      estimatedCostUsd: 0.001,
    });

    const result = await runAutonomousAgent({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      draftingRules: ["Draft concise, warm, useful replies."],
      candidates: [],
      readThread,
      searchMailbox,
      searchAttachments,
      readMessage,
    });

    expect(readMessage).toHaveBeenCalledTimes(30);
    expect(readMessage).not.toHaveBeenCalledWith("msg_30");
    expect(result.totalCostUsd).toBeCloseTo(0.032, 10);
  });

  it("appends structured tool results to subsequent agent conversation turns", async () => {
    const candidates: Candidate[] = [
      {
        gmailThreadId: "thread_123",
        gmailHistoryId: "history_123",
        subject: "Pricing question",
        snippet: "Can you help with pricing?",
        fromEmail: "alex@example.com",
        fromName: "Alex",
        latestMessageAt: "2026-04-07T10:00:00.000Z",
        latestMessageId: "msg_current",
        hasUnread: true,
      },
    ];
    const readThread = vi.fn().mockResolvedValue({
      threadId: "thread_123",
      snippet: "Current thread",
      messages: [
        {
          gmailMessageId: "msg_current",
          date: "2026-04-07T10:00:00.000Z",
          from: "Alex <alex@example.com>",
          to: "me@example.com",
          subject: "Pricing question",
          messageId: "<msg_current@example.com>",
          references: null,
          text: "Can you help with pricing?",
        },
      ],
    });
    const searchMailbox = vi.fn();
    const searchAttachments = vi.fn();
    const readMessage = vi.fn();

    askGeminiFunctionCallWithUsage
      .mockResolvedValueOnce({
        functionCall: {
          name: "read_thread",
          args: {
            threadId: "thread_123",
            reason: "Inspect the current request first.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "read_thread", args: { threadId: "thread_123", reason: "Inspect the current request first." } } }] },
        estimatedCostUsd: 0.01,
      })
      .mockResolvedValueOnce({
        functionCall: {
          name: "finish",
          args: {
            reason: "Done.",
          },
        },
        content: { role: "model", parts: [{ functionCall: { name: "finish", args: { reason: "Done." } } }] },
        estimatedCostUsd: 0.01,
      });

    await runAutonomousAgent({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      draftingRules: ["Draft concise, warm, useful replies."],
      candidates,
      readThread,
      searchMailbox,
      searchAttachments,
      readMessage,
    });

    const secondContents = askGeminiFunctionCallWithUsage.mock.calls[1]?.[0]?.contents as
      | Array<{ role: string; parts: Array<Record<string, unknown>> }>
      | undefined;
    expect(secondContents).toBeTruthy();
    const toolResultMessage = [...(secondContents ?? [])]
      .reverse()
      .find(
        (message) =>
          message.role === "user" &&
          message.parts.some((part) => "functionResponse" in part),
      );
    expect(toolResultMessage?.role).toBe("user");

    const parsedToolResult = toolResultMessage?.parts[0]?.functionResponse as {
      name: string;
      response: {
        threadId: string;
        reason: string;
        result: {
          threadId: string;
          messages: Array<Record<string, unknown>>;
        };
      };
    };
    expect(parsedToolResult).toMatchObject({
      name: "read_thread",
      response: {
        threadId: "thread_123",
        reason: "Inspect the current request first.",
      },
    });
    expect(parsedToolResult?.response.result).toMatchObject({
      threadId: "thread_123",
      messages: [
        expect.objectContaining({
          gmailMessageId: "msg_current",
          text: "Can you help with pricing?",
        }),
      ],
    });
  });
});
