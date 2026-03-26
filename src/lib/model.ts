import { createOpenAI } from "@ai-sdk/openai";
import { openai as createAgentKitOpenAI } from "@inngest/agent-kit";

export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL ?? "openrouter/free";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: OPENROUTER_BASE_URL,
});

export type ModelErrorInfo = {
  code:
    | "RATE_LIMIT_EXCEEDED"
    | "DAILY_QUOTA_EXCEEDED"
    | "PROVIDER_QUOTA_EXCEEDED"
    | "AUTHENTICATION_FAILED"
    | "MODEL_UNAVAILABLE"
    | "PROVIDER_INVALID_RESPONSE"
    | "MODEL_REQUEST_FAILED";
  status: number;
  reason: string;
  message: string;
  rawMessage: string;
};

export function getTextModel() {
  return openrouter(DEFAULT_MODEL);
}

export function getAgentTextModel(
  model = DEFAULT_MODEL,
  defaultParameters?: {
    temperature?: number;
    max_completion_tokens?: number;
  },
) {
  return createAgentKitOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: OPENROUTER_BASE_URL,
    model,
    defaultParameters,
  });
}

function getRawMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function parseModelError(error: unknown): ModelErrorInfo {
  const rawMessage = getRawMessage(error);
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes("429") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("rate limit")
  ) {
    return {
      code: "RATE_LIMIT_EXCEEDED",
      status: 429,
      reason: "The project is hitting the model provider rate limit.",
      message:
        "The model provider rejected the request with HTTP 429 Too Many Requests. Slow down request frequency or wait for the limit window to reset.",
      rawMessage,
    };
  }

  if (
    normalizedMessage.includes("quota exceeded") ||
    normalizedMessage.includes("insufficient_quota") ||
    normalizedMessage.includes("free_tier") ||
    normalizedMessage.includes("daily limit") ||
    normalizedMessage.includes("rpd")
  ) {
    return {
      code: "DAILY_QUOTA_EXCEEDED",
      status: 429,
      reason: "The current provider quota appears to be exhausted.",
      message:
        "The model provider rejected the request because the current quota is exhausted. Wait for quota reset, switch to a different project, or enable billing.",
      rawMessage,
    };
  }

  if (
    normalizedMessage.includes("api key") ||
    normalizedMessage.includes("authentication") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("permission denied") ||
    normalizedMessage.includes("403")
  ) {
    return {
      code: "AUTHENTICATION_FAILED",
      status: 401,
      reason: "The provider API key is invalid or not authorized for this request.",
      message:
        "Authentication failed. Check OPENROUTER_API_KEY and confirm the key is valid for OpenRouter.",
      rawMessage,
    };
  }

  if (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("unsupported model") ||
    normalizedMessage.includes("model")
  ) {
    return {
      code: "MODEL_UNAVAILABLE",
      status: 400,
      reason: "The configured model name is unavailable for this provider.",
      message: `The model '${DEFAULT_MODEL}' is unavailable. Check OPENROUTER_MODEL and provider access.`,
      rawMessage,
    };
  }

  if (
    normalizedMessage.includes("invalid json response") ||
    normalizedMessage.includes("unexpected token") ||
    normalizedMessage.includes("bad gateway") ||
    normalizedMessage.includes("gateway")
  ) {
    return {
      code: "PROVIDER_INVALID_RESPONSE",
      status: 502,
      reason:
        "The provider returned an invalid or gateway-level response for this model request.",
      message:
        "The model provider returned an invalid response. This is often caused by an overloaded free model, a provider gateway issue, or an oversized prompt.",
      rawMessage,
    };
  }

  return {
    code: "MODEL_REQUEST_FAILED",
    status: 500,
    reason: "The model request failed for an unclassified reason.",
    message: rawMessage || "Unknown model error.",
    rawMessage,
  };
}

export function formatModelError(error: unknown) {
  return parseModelError(error).message;
}
