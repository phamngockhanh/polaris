import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  projectId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      return NextResponse.json(
        { error: "Internal key not configured" },
        { status: 500 },
      );
    }

    const body = await request.json();
    const { projectId } = requestSchema.parse(body);

    const processingMessages = await convex.query(
      api.system.getProcessingMessages,
      {
        internalKey,
        projectId: projectId as Id<"projects">,
      },
    );

    if (processingMessages.length === 0) {
      return NextResponse.json({ success: true, cancelled: 0 });
    }

    await Promise.all(
      processingMessages.map(async (message) => {
        await convex.mutation(api.system.updateMessageStatus, {
          internalKey,
          messageId: message._id,
          status: "cancelled",
        });
      }),
    );

    return NextResponse.json({
      success: true,
      cancelled: processingMessages.length,
    });
  } catch (error) {
    console.error("Failed to cancel messages:", error);

    const message =
      error instanceof Error ? error.message : "Unable to cancel request";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
