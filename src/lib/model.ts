import { createOpenAI } from "@ai-sdk/openai";

export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL ?? "openrouter/free";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: "https://openrouter.ai/api/v1",
});

export type ModelErrorInfo = {
  code:
    | "RATE_LIMIT_EXCEEDED"
    | "DAILY_QUOTA_EXCEEDED"
    | "PROVIDER_QUOTA_EXCEEDED"
    | "AUTHENTICATION_FAILED"
    | "MODEL_UNAVAILABLE"
    | "MODEL_REQUEST_FAILED";
  status: number;
  reason: string;
  message: string;
  rawMessage: string;
};

export function getTextModel() {
  return openrouter(DEFAULT_MODEL);
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
