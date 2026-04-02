import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { convex } from "@/lib/convex-client";
import { inngest } from "@/inngest/client";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
});

function normalizePathSegments(rawPath: string) {
  return rawPath
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== "." && segment !== "..");
}

function extractQuotedValue(message: string) {
  const match = message.match(/["'`](.+?)["'`]/);
  return match?.[1]?.trim() || null;
}

function extractQuotedValues(message: string) {
  return [...message.matchAll(/["'`](.+?)["'`]/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function splitFileNames(rawValue: string) {
  return rawValue
    .split(/\s*(?:,|and)\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function toPascalCase(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function getDefaultFileContent(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const componentName = toPascalCase(fileName) || "Component";

  switch (extension) {
    case "tsx":
      return `export default function ${componentName}() {\n  return <div>${componentName}</div>;\n}\n`;
    case "ts":
      return `export function ${componentName}() {\n  return "${componentName}";\n}\n`;
    case "jsx":
      return `export default function ${componentName}() {\n  return <div>${componentName}</div>;\n}\n`;
    case "js":
      return `export function ${componentName}() {\n  return "${componentName}";\n}\n`;
    case "json":
      return "{\n  \"name\": \"value\"\n}\n";
    case "css":
      return `.${fileName.replace(/\.[^.]+$/, "")} {\n}\n`;
    case "md":
      return `# ${componentName}\n`;
    default:
      return "";
  }
}

function extractSimpleCreateIntent(message: string):
  | { type: "folder"; path: string }
  | {
      type: "files";
      fileNames: string[];
      parentFolderPath?: string;
      withSimpleContent: boolean;
    }
  | null {
  const normalized = message.toLowerCase().trim();
  const quoted = extractQuotedValue(message);
  const quotedValues = extractQuotedValues(message);
  const targetFolderMatch = message.match(
    /(?:in|inside)\s+(?:the\s+)?folder\s+["'`](.+?)["'`]/i,
  );
  const targetFolderPath = targetFolderMatch?.[1]?.trim();
  const withSimpleContent =
    normalized.includes("simple content") ||
    normalized.includes("content inside") ||
    normalized.includes("put content inside");

  if (
    normalized.includes("file") &&
    (normalized.includes("create") || normalized.includes("make"))
  ) {
    const fileNames = quotedValues.filter((value) => value !== targetFolderPath);

    if (fileNames.length > 0) {
      return {
        type: "files",
        fileNames,
        parentFolderPath: targetFolderPath,
        withSimpleContent,
      };
    }

    const directPathMatch = message.match(
      /(?:called|named)\s+(.+?)(?:\s+(?:in|inside)\s+(?:the\s+)?folder\b|[.!?]|$)/i,
    );
    const rawNames = directPathMatch?.[1]?.trim();

    if (rawNames) {
      return {
        type: "files",
        fileNames: splitFileNames(rawNames),
        parentFolderPath: targetFolderPath,
        withSimpleContent,
      };
    }
  }

  if (
    normalized.includes("folder") &&
    (normalized.includes("create") || normalized.includes("make"))
  ) {
    const directPathMatch = message.match(
      /(?:called|named)\s+["'`]?([^"'`\n]+?)["'`]?(?:[.!?]|$)/i,
    );
    const path = quoted || directPathMatch?.[1]?.trim();

    if (path) {
      return { type: "folder", path };
    }
  }

  return null;
}

async function ensureFolderPath(params: {
  internalKey: string;
  projectId: Id<"projects">;
  pathSegments: string[];
}) {
  const { internalKey, projectId, pathSegments } = params;

  let parentId: Id<"files"> | undefined;

  for (const segment of pathSegments) {
    const projectFiles = await convex.query(api.system.getProjectFiles, {
      internalKey,
      projectId,
    });

    const existingFolder = projectFiles.find(
      (file) =>
        file.type === "folder" &&
        file.parentId === parentId &&
        file.name === segment,
    );

    if (existingFolder) {
      parentId = existingFolder._id;
      continue;
    }

    parentId = await convex.mutation(api.system.createFolder, {
      internalKey,
      projectId,
      name: segment,
      parentId,
    });
  }

  return parentId;
}

export async function POST(request: Request) {
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
  const { conversationId, message } = requestSchema.parse(body);

  // Call convex mutation, query
  const conversation = await convex.query(api.system.getConversationById, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  const projectId = conversation.projectId;

  // Find all processing messages in this project
  const processingMessages = await convex.query(
    api.system.getProcessingMessages,
    {
      internalKey,
      projectId,
    },
  );

  if (processingMessages.length > 0) {
    await Promise.all(
      processingMessages.map(async (msg) => {
        await convex.mutation(api.system.updateMessageStatus, {
          internalKey,
          messageId: msg._id,
          status: "cancelled",
        });
      }),
    );
  }

  // Create user message
  await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
    projectId,
    role: "user",
    content: message,
  });

  // Create assistant message placeholder with processing status
  const assistantMessageId = await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
    projectId,
    role: "assistant",
    content: "",
    status: "processing",
  });

  const simpleIntent = extractSimpleCreateIntent(message);

  if (simpleIntent) {
    try {
      if (simpleIntent.type === "folder") {
        const pathSegments = normalizePathSegments(simpleIntent.path);

        if (pathSegments.length === 0) {
          throw new Error("Invalid path");
        }

        await ensureFolderPath({
          internalKey,
          projectId,
          pathSegments,
        });

        await convex.mutation(api.system.updateMessageContent, {
          internalKey,
          messageId: assistantMessageId,
          content: `Created folder "${pathSegments.join("/")}".`,
        });
      } else {
        const parentId = simpleIntent.parentFolderPath
          ? await ensureFolderPath({
              internalKey,
              projectId,
              pathSegments: normalizePathSegments(simpleIntent.parentFolderPath),
            })
          : undefined;

        const files = simpleIntent.fileNames.map((fileName) => ({
          name: fileName,
          content: simpleIntent.withSimpleContent
            ? getDefaultFileContent(fileName)
            : "",
        }));

        await convex.mutation(api.system.createFiles, {
          internalKey,
          projectId,
          parentId,
          files,
        });

        const createdPaths = files.map((file) =>
          simpleIntent.parentFolderPath
            ? `${simpleIntent.parentFolderPath}/${file.name}`
            : file.name,
        );

        await convex.mutation(api.system.updateMessageContent, {
          internalKey,
          messageId: assistantMessageId,
          content:
            files.length === 1
              ? `Created file "${createdPaths[0]}".`
              : `Created files: ${createdPaths.map((path) => `"${path}"`).join(", ")}.`,
        });
      }

      return NextResponse.json({
        success: true,
        messageId: assistantMessageId,
        direct: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to create item";

      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId: assistantMessageId,
        content: errorMessage,
      });

      return NextResponse.json({
        success: false,
        messageId: assistantMessageId,
        error: errorMessage,
      });
    }
  }

  // try {
  //   await processConversationMessage({
  //     messageId: assistantMessageId,
  //     conversationId,
  //     message,
  //   });
  // } catch (error) {
  //   console.error("Failed to process conversation message:", error);
  //   return NextResponse.json(
  //     { error: "Failed to process message." },
  //     { status: 500 },
  //   );
  // }

  const event = await inngest.send({
    name: "message/sent",
    data: {
      messageId: assistantMessageId,
      conversationId,
      projectId,
      message,
    },
  });
  return NextResponse.json({
    success: true,
    eventId: event.ids[0],
    messageId: assistantMessageId,
  });
}
