import { z } from "zod";
import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

import { convex } from "@/lib/convex-client";
import { inngest } from "@/inngest/client";

import { api } from "../../../../../convex/_generated/api";

const requestSchema = z.object({
  url: z.url(),
});

function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Invalid GitHub URL");
  }

  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

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

      console.log("[github/import] OAuth token lookup", {
        userId,
        provider,
        tokenCount: tokens.data.length,
      });

      if (githubToken) {
        return githubToken;
      }
    } catch (error) {
      console.error("[github/import] OAuth token lookup failed", {
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

  const body = await request.json();
  const { url } = requestSchema.parse(body);

  const { owner, repo } = parseGitHubUrl(url);
  // https://github.com/AntonioErdeljac/cursor-dev
  // { owner: "AntonioErdeljac", repo: "cursor-dev" }

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
          : "GitHub is not connected for this account. Connect GitHub first, then try importing again.",
        code: "GITHUB_OAUTH_TOKEN_MISSING",
        hasGithubConnection,
        externalProviders: user.externalAccounts.map((account) => account.provider),
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

  const projectId = await convex.mutation(api.system.createProject, {
    internalKey,
    name: repo,
    ownerId: userId,
  });

  const event = await inngest.send({
    name: "github/import.repo",
    data: {
      owner,
      repo,
      projectId,
      githubToken,
    },
  });

  return NextResponse.json({ 
    success: true, 
    projectId, 
    eventId: event.ids[0]
  });
};
