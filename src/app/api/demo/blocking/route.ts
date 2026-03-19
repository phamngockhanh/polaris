import { generateText } from "ai";
import { getTextModel, parseModelError } from "@/lib/model";

function getKeyFingerprint() {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  return key ? key.slice(-4) : "missing";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt =
    typeof body.prompt === "string" && body.prompt.trim()
      ? body.prompt.trim()
      : "Write a vegetarian lasagna recipe for 4 people.";

  try {
    const response = await generateText({
      model: getTextModel(),
      prompt,
      experimental_telemetry : {
        isEnabled: true,
        recordInputs: true,
        recordOutputs:true,
      }
    });

    return Response.json({ ok: true, text: response.text, prompt });
  } catch (error) {
    const parsedError = parseModelError(error);

    return Response.json(
      {
        ok: false,
        prompt,
        model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
        keyFingerprint: getKeyFingerprint(),
        error: parsedError.message,
        errorInfo: parsedError,
      },
      { status: parsedError.status },
    );
  }
}
