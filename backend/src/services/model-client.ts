import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content as GoogleGenAIContent,
  type FunctionCall as GoogleGenAIFunctionCall,
  type FunctionDeclaration as GoogleGenAIFunctionDeclaration,
  type FunctionResponse as GoogleGenAIFunctionResponse,
  type Part as GoogleGenAIPart,
} from "@google/genai";
import { env } from "../lib/env.js";
import { extractJson } from "../lib/json.js";
import { logger } from "../lib/logger.js";
import { addTraceEvent } from "../lib/langsmith.js";
import { traceableIfEnabled } from "../lib/langsmith.js";
import type { AgentProvider } from "../types/models.js";
import { estimateUsageCostUsd } from "./model-pricing.js";
import type { UsageMetadata } from "langsmith/schemas";

type StructuredResponseSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ModelRequest = {
  provider: AgentProvider;
  model: string;
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  responseSchema?: StructuredResponseSchema;
  maxOutputTokens?: number;
};

type ModelCallResult = {
  text: string;
  usageMetadata?: UsageMetadata;
};

export type GeminiFunctionDeclaration = GoogleGenAIFunctionDeclaration;
export type GeminiFunctionCall = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};
export type GeminiFunctionResponse = GoogleGenAIFunctionResponse;
export type GeminiContentPart = GoogleGenAIPart;
export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiContentPart[];
};

type GeminiFunctionCallRequest = {
  model: string;
  system?: string;
  contents: GeminiContent[];
  functionDeclarations: GeminiFunctionDeclaration[];
  allowedFunctionNames?: string[];
  maxOutputTokens?: number;
};

type GeminiFunctionCallResult = {
  functionCall: GeminiFunctionCall;
  content: GeminiContent;
  usageMetadata?: UsageMetadata;
};

const MODEL_REQUEST_TIMEOUT_MS = 120_000;
const MODEL_MAX_RETRIES = 2;
const TRACE_TEXT_PREVIEW_CHARS = 400;
const RETRY_BASE_DELAY_MS = 300;

function createRequestSignal() {
  return AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS);
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient() {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  return geminiClient;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) {
    return true;
  }

  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /temporar|retry|timeout|timed out|network|json/i.test(message)
  );
}

function getRetryDelayMs(attempt: number) {
  return Math.min(4_000, RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
}

function trimTraceText(value: unknown, maxChars = TRACE_TEXT_PREVIEW_CHARS) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n...[truncated]`;
}

function summarizeTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => summarizeTraceValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, summarizeTraceValue(nestedValue)]),
    );
  }

  return trimTraceText(value);
}

function parseStructuredTracePrompt(prompt: string) {
  try {
    const parsed = JSON.parse(prompt) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || !("objective" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function renderTraceSections(title: string, value: unknown) {
  return `## ${title}\n\`\`\`json\n${JSON.stringify(summarizeTraceValue(value), null, 2)}\n\`\`\``;
}

export function formatPromptForTrace(prompt: string) {
  const parsed = parseStructuredTracePrompt(prompt);
  if (!parsed) {
    return prompt;
  }

  const sections = [
    renderTraceSections("Objective", parsed.objective ?? null),
    renderTraceSections("Candidates", parsed.candidates ?? []),
    renderTraceSections("State", {
      inspectedThreadIds: parsed.inspectedThreadIds ?? [],
      contextMessagesRead: parsed.contextMessagesRead ?? 0,
      contextMessagesRemaining: parsed.contextMessagesRemaining ?? 0,
      draftedThreadIds: parsed.draftedThreadIds ?? [],
    }),
  ];

  if (Array.isArray(parsed.notes) && parsed.notes.length > 0) {
    sections.push(renderTraceSections("Notes", parsed.notes));
  }

  return sections.join("\n\n");
}

function getRequestMessages(request: ModelRequest): ModelMessage[] {
  if (request.messages?.length) {
    return [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      ...request.messages,
    ];
  }

  return [
    ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
    ...(request.prompt ? [{ role: "user" as const, content: request.prompt }] : []),
  ];
}

function formatMessageContentForTrace(message: ModelMessage) {
  if (message.role !== "user") {
    return message.content;
  }

  return formatPromptForTrace(message.content);
}

function toGeminiRequest(messages: ModelMessage[]) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversationMessages = messages.filter((message) => message.role !== "system");

  return {
    systemInstruction: systemMessages.length > 0 ? systemMessages.map((message) => message.content).join("\n\n") : undefined,
    contents: conversationMessages.map(
      (message) =>
        ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        }) satisfies GoogleGenAIContent,
    ),
  };
}

function toGeminiUsage(usage: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
} | null | undefined): UsageMetadata | undefined {
  if (
    typeof usage?.promptTokenCount !== "number" ||
    typeof usage?.candidatesTokenCount !== "number" ||
    typeof usage?.totalTokenCount !== "number"
  ) {
    return undefined;
  }

  return {
    input_tokens: usage.promptTokenCount,
    output_tokens: usage.candidatesTokenCount,
    total_tokens: usage.totalTokenCount,
  };
}

function toGeminiContents(contents: GeminiContent[]) {
  return contents.map((content) => ({
    role: content.role,
    parts: content.parts.map((part) => {
      if (typeof part.text === "string") {
        return {
          text: part.text,
          ...(part.thought ? { thought: part.thought } : {}),
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        };
      }
      if (part.functionCall) {
        return {
          functionCall: {
            name: part.functionCall.name,
            args: part.functionCall.args,
            ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
          },
          ...(part.thought ? { thought: part.thought } : {}),
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        };
      }
      const functionResponse = part.functionResponse;
      return {
        functionResponse: {
          name: functionResponse?.name,
          response: functionResponse?.response,
          ...(functionResponse?.id ? { id: functionResponse.id } : {}),
        },
        ...(part.thought ? { thought: part.thought } : {}),
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      };
    }),
  })) satisfies GoogleGenAIContent[];
}

function formatGeminiContentForTrace(content: GeminiContent) {
  return content.parts.map((part) => {
    if (typeof part.text === "string") {
      return { type: "text", text: formatPromptForTrace(part.text) };
    }
    if (part.functionCall) {
      return {
        type: "text",
        text: JSON.stringify(
          {
            functionCall: part.functionCall,
          },
          null,
          2,
        ),
      };
    }
    return {
      type: "text",
      text: JSON.stringify(
        {
          functionResponse: part.functionResponse,
        },
        null,
        2,
      ),
    };
  });
}

async function callGemini({
  model,
  system,
  prompt,
  messages,
  responseSchema,
  maxOutputTokens,
}: Omit<ModelRequest, "provider">): Promise<ModelCallResult> {
  const requestMessages = getRequestMessages({
    provider: "gemini",
    model,
    system,
    prompt,
    messages,
    responseSchema,
    maxOutputTokens,
  });
  const geminiRequest = toGeminiRequest(requestMessages);
  const data = await getGeminiClient().models.generateContent({
    model,
    contents: geminiRequest.contents,
    config: {
      abortSignal: createRequestSignal(),
      temperature: 0.2,
      ...(geminiRequest.systemInstruction
        ? {
            systemInstruction: geminiRequest.systemInstruction,
          }
        : {}),
      ...(responseSchema
        ? {
            responseMimeType: "application/json",
            responseJsonSchema: responseSchema.schema,
          }
        : {}),
      ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
    },
  });
  return {
    text: data.text ?? "{}",
    usageMetadata: toGeminiUsage(data.usageMetadata),
  };
}

async function callGeminiFunctionCall({
  model,
  system,
  contents,
  functionDeclarations,
  allowedFunctionNames,
  maxOutputTokens,
}: GeminiFunctionCallRequest): Promise<GeminiFunctionCallResult> {
  const data = await getGeminiClient().models.generateContent({
    model,
    contents: toGeminiContents(contents),
    config: {
      abortSignal: createRequestSignal(),
      temperature: 0.2,
      ...(system
        ? {
            systemInstruction: system,
          }
        : {}),
      tools: [{ functionDeclarations }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          ...(allowedFunctionNames?.length ? { allowedFunctionNames } : {}),
        },
      },
      ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
    },
  });

  const functionCalls = (data.functionCalls ?? []).flatMap((functionCall) => {
    if (!functionCall.name) {
      return [];
    }
    return [
      {
        id: functionCall.id,
        name: functionCall.name,
        args: (functionCall.args ?? {}) as Record<string, unknown>,
      } satisfies GeminiFunctionCall,
    ];
  });

  if (functionCalls.length === 0) {
    throw new Error(
      `Gemini did not return a function call: ${JSON.stringify(
        data.candidates?.[0]?.content?.parts ?? [],
        null,
        2,
      )}`,
    );
  }

  const candidateContent = data.candidates?.[0]?.content;
  const content: GeminiContent = {
    role: candidateContent?.role === "user" ? "user" : "model",
    parts:
      (candidateContent?.parts?.map((part) => {
        if (part.functionCall?.name) {
          return {
            functionCall: {
              ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
              name: part.functionCall.name,
              args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            },
            ...(part.thought ? { thought: part.thought } : {}),
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          } satisfies GeminiContentPart;
        }
        if (part.functionResponse) {
          return {
            functionResponse: {
              ...(part.functionResponse.id ? { id: part.functionResponse.id } : {}),
              name: part.functionResponse.name,
              response: (part.functionResponse.response ?? {}) as Record<string, unknown>,
            },
            ...(part.thought ? { thought: part.thought } : {}),
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          } satisfies GeminiContentPart;
        }
        return {
          text: part.text ?? "",
          ...(part.thought ? { thought: part.thought } : {}),
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        } satisfies GeminiContentPart;
      }) ?? []),
  };

  return {
    functionCall: functionCalls[0],
    content,
    usageMetadata: toGeminiUsage(data.usageMetadata),
  };
}

const invokeModel = traceableIfEnabled(
  async (request: ModelRequest) => {
    const result = await callGemini(request);

    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: result.text,
          },
        },
      ],
      usage_metadata: result.usageMetadata,
    };
  },
  {
    name: "Agent model call",
    run_type: "llm",
    tags: ["gmail-auto-responder", "agent"],
    metadata: {
      integration: "manual-fetch",
      component: "model-client",
    },
    getInvocationParams: (request) => ({
      ls_provider: request.provider,
      ls_model_name: request.model,
      ls_model_type: "chat",
      ls_temperature: 0.2,
    }),
    processInputs: (request) => ({
      model: request.model,
      messages: getRequestMessages(request).map((message) => ({
        role: message.role === "assistant" ? "assistant" : message.role,
        content: [{ type: "text", text: formatMessageContentForTrace(message) }],
      })),
    }),
  },
);

const invokeGeminiFunctionCall = traceableIfEnabled(
  async (request: GeminiFunctionCallRequest) => {
    return callGeminiFunctionCall(request);
  },
  {
    name: "Agent function call",
    run_type: "llm",
    tags: ["gmail-auto-responder", "agent", "function-calling"],
    metadata: {
      integration: "manual-fetch",
      component: "model-client",
      mode: "gemini-function-calling",
    },
    getInvocationParams: (request) => ({
      ls_provider: "gemini",
      ls_model_name: request.model,
      ls_model_type: "chat",
      ls_temperature: 0.2,
    }),
    processInputs: (request) => ({
      model: request.model,
      functionDeclarations: request.functionDeclarations.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
      contents: request.contents.map((content) => ({
        role: content.role,
        content: formatGeminiContentForTrace(content),
      })),
    }),
  },
);

export async function askModel<T>(request: ModelRequest) {
  const response = await askModelWithUsage<T>(request);
  return response.data;
}

export async function askModelWithUsage<T>(request: ModelRequest) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_MAX_RETRIES + 1; attempt += 1) {
    addTraceEvent("model_call_attempt", {
      kwargs: {
        attempt,
        provider: request.provider,
        model: request.model,
      },
    });

    try {
      const response = await invokeModel(request);
      const usageMetadata = response.usage_metadata as UsageMetadata | undefined;

      return {
        data: extractJson<T>(response.choices[0]?.message?.content ?? "{}"),
        usageMetadata,
        estimatedCostUsd: estimateUsageCostUsd({
          provider: request.provider,
          model: request.model,
          usageMetadata,
        }),
      };
    } catch (error) {
      lastError = error;
      const isRetryable = shouldRetryModelError(error);

      logger.warn("Model call attempt failed", {
        provider: request.provider,
        model: request.model,
        attempt,
        maxAttempts: MODEL_MAX_RETRIES + 1,
        retriable: isRetryable,
        error: error instanceof Error ? error.message : String(error),
      });

      addTraceEvent("model_call_error", {
        kwargs: {
          attempt,
          provider: request.provider,
          model: request.model,
          retriable: isRetryable,
          error: error instanceof Error ? error.message : String(error),
          willRetry: isRetryable && attempt < MODEL_MAX_RETRIES + 1,
        },
      });

      if (!isRetryable || attempt >= MODEL_MAX_RETRIES + 1) {
        break;
      }

      await sleep(getRetryDelayMs(attempt));
    }
  }

  throw new Error(
    `Model call failed after ${MODEL_MAX_RETRIES + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function askGeminiFunctionCallWithUsage(request: GeminiFunctionCallRequest) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_MAX_RETRIES + 1; attempt += 1) {
    addTraceEvent("model_call_attempt", {
      kwargs: {
        attempt,
        provider: "gemini",
        model: request.model,
        mode: "function_calling",
      },
    });

    try {
      const response = await invokeGeminiFunctionCall(request);
      return {
        functionCall: response.functionCall,
        content: response.content,
        usageMetadata: response.usageMetadata,
        estimatedCostUsd: estimateUsageCostUsd({
          provider: "gemini",
          model: request.model,
          usageMetadata: response.usageMetadata,
        }),
      };
    } catch (error) {
      lastError = error;
      const isRetryable = shouldRetryModelError(error);

      logger.warn("Model call attempt failed", {
        provider: "gemini",
        model: request.model,
        attempt,
        maxAttempts: MODEL_MAX_RETRIES + 1,
        retriable: isRetryable,
        error: error instanceof Error ? error.message : String(error),
      });

      addTraceEvent("model_call_error", {
        kwargs: {
          attempt,
          provider: "gemini",
          model: request.model,
          mode: "function_calling",
          retriable: isRetryable,
          error: error instanceof Error ? error.message : String(error),
          willRetry: isRetryable && attempt < MODEL_MAX_RETRIES + 1,
        },
      });

      if (!isRetryable || attempt >= MODEL_MAX_RETRIES + 1) {
        break;
      }

      await sleep(getRetryDelayMs(attempt));
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Model call failed after ${MODEL_MAX_RETRIES + 1} attempts: ${reason}`);
}
