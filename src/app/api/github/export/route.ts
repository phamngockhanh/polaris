import { z } from "zod";
import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

import { inngest } from "@/inngest/client";

const requestSchema = z.object({
  projectId: z.string(),
  repoName: z.string().min(1).max(100),
  visibility: z.enum(["public", "private"]).default("private"),
  description: z.string().max(350).optional(),
});

async function getGithubAccessToken(userId: string) {
  const client = await clerkClient();
  const providers = ["oauth_github", "github"] as const;

  for (const provider of providers) {
    try {
      const tokens = await (
        client.users.getUserOauthAccessToken as (
          uid: string,
          p: string
        ) => Promise<{ data: Array<{ token?: string }> }>
      )(userId, provider);
      const githubToken = tokens.data[0]?.token;

      console.log("[github/export] OAuth token lookup", {
        userId,
        provider,
        tokenCount: tokens.data.length,
      });

      if (githubToken) {
        return githubToken;
      }
    } catch (error) {
      console.error("[github/export] OAuth token lookup failed", {
        userId,
        provider,
        error,
      });
    }
  }

  return null;
}

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedRequest = requestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        issues: parsedRequest.error.issues,
      },
      { status: 400 }
    );
  }

  const { projectId, repoName, visibility, description } = parsedRequest.data;

  const githubToken = await getGithubAccessToken(userId);

  if (!githubToken) {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const hasGithubConnection = user.externalAccounts.some((account) =>
      account.provider.toLowerCase().includes("github")
    );

    return NextResponse.json(
      {
        error: hasGithubConnection
          ? "GitHub is connected but no OAuth token is available. Reconnect GitHub in your account settings and ensure the app is approved with required scopes."
          : "GitHub is not connected for this account. Connect GitHub first, then try exporting again.",
        code: "GITHUB_OAUTH_TOKEN_MISSING",
      },
      { status: 400 }
    );
  }

  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  try {
    const event = await inngest.send({
      name: "github/export.repo",
      data: {
        projectId,
        repoName,
        visibility,
        description,
        githubToken,
        internalKey,
      },
    });

    return NextResponse.json({
      success: true,
      projectId,
      eventId: event.ids[0] ?? null,
    });
  } catch (error) {
    console.error("[github/export] Failed to enqueue export event", {
      userId,
      projectId,
      repoName,
      error,
    });

    return NextResponse.json(
      { error: "Failed to start GitHub export" },
      { status: 500 }
    );
  }
}
