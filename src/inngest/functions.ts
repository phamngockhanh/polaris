import { inngest } from "./client";
import { generateText } from "ai";
import { firecrawl } from "@/lib/firecrawl";
import { getTextModel, parseModelError } from "@/lib/model";

const URL_REGEX = /https?:\/\/\S+/gi;
const MAX_CONTEXT_CHARS = 12000;

function normalizePrompt(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function extractUrls(text: string) {
  return (text.match(URL_REGEX) ?? []).map((url) =>
    url.replace(/[),.!?]+$/g, ""),
  );
}

function isYouTubeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname.includes("youtu.be")
    );
  } catch {
    return false;
  }
}

async function getYouTubeContext(url: string) {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("format", "json");

  const response = await fetch(endpoint.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    title?: string;
    author_name?: string;
    provider_name?: string;
  };

  return [
    "YouTube video metadata:",
    `Title: ${data.title ?? "Unknown"}`,
    `Channel: ${data.author_name ?? "Unknown"}`,
    `Provider: ${data.provider_name ?? "YouTube"}`,
    `URL: ${url}`,
    "Note: This is metadata only. The app does not have the audio transcript unless another transcript source is added.",
  ].join("\n");
}

export const demoGenerate = inngest.createFunction(
  { id: "demo-generate" },
  { event: "demo/generate" },
  async ({ event, step }) => {
    const prompt = normalizePrompt(
      (event.data as { prompt?: unknown } | undefined)?.prompt,
    );
    if (!prompt) {
      throw new Error("Missing prompt in event data.");
    }

    const urls = (await step.run("extract-urls", async () => {
      return extractUrls(prompt);
    })) as string[];

    const scrapedContent = await step.run("scrape-urls", async () => {
      const results = await Promise.all(
        urls.map(async (url) => {
          if (isYouTubeUrl(url)) {
            return await getYouTubeContext(url);
          }

          const result = await firecrawl.scrape(url, {
            formats: ["markdown"],
          });
          return result.markdown ?? null;
        }),
      );
      return results.filter(Boolean).join("\n\n").slice(0, MAX_CONTEXT_CHARS);
    });

    const finalPrompt = scrapedContent
      ? `Use the context below if it is relevant. If the context is insufficient, say what is missing instead of guessing.\nIf the user asks about a YouTube video and only metadata is available, do not claim to know the sung song unless the title or provided context explicitly identifies it.\n\nContext:\n${scrapedContent}\n\nQuestion: ${prompt}`
      : prompt;

    return await step.run("generate-text", async () => {
      try {
        const result = await generateText({
          model: getTextModel(),
          prompt: finalPrompt,
          experimental_telemetry: {
            isEnabled: true,
            recordInputs: true,
            recordOutputs: true,
          },
        });

        return {
          ok: true,
          text: result.text,
          prompt,
          finalPrompt,
          urls,
        };
      } catch (error) {
        const parsedError = parseModelError(error);

        return {
          ok: false,
          prompt,
          finalPrompt,
          urls,
          error: parsedError,
        };
      }
    });
  },
);

export const demoError = inngest.createFunction(
  { id: "demo-error" },
  { event: "demo/error" },
  async ({ step }) => {
    await step.run("fail", async () => {
      throw new Error("Inngest error: Background job failed!");
    });
  },
);
