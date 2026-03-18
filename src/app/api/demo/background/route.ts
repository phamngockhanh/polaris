import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json(
      { error: "Missing prompt in request body." },
      { status: 400 },
    );
  }

  const event = await inngest.send({
    name: "demo/generate",
    data: { prompt },
  });

  return Response.json({ status: "started", event });
}
