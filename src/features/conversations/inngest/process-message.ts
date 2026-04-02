import { createAgent, createNetwork } from "@inngest/agent-kit";

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { DEFAULT_MODEL, getAgentTextModel } from "@/lib/model";
import { NonRetriableError } from "inngest";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  TITLE_GENERATOR_SYSTEM_PROMPT,
} from "./constants";
import { createListFilesTool } from "./tools/list-files";
import { createReadFilesTool } from "./tools/read-files";
import { createUpdateFileTool } from "./tools/update-file";
import { createCreateFilesTool } from "./tools/create-files";
import { createCreateFolderTool } from "./tools/create-folder";
import { createRenameFileTool } from "./tools/rename-file";
import { createDeleteFilesTool } from "./tools/delete-files";
import { createScrapeUrlsTool } from "./tools/scrape-urls";

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
}

type ExtractedFile = {
  path: string;
  content: string;
};

type ProjectPlan = {
  files: ExtractedFile[];
  settings?: {
    installCommand?: string;
    devCommand?: string;
  };
  summary?: string;
};

function getTextContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (
          contentPart,
        ): contentPart is { type: "text"; text: string } =>
          typeof contentPart === "object" &&
          contentPart !== null &&
          "type" in contentPart &&
          "text" in contentPart &&
          contentPart.type === "text" &&
          typeof contentPart.text === "string",
      )
      .map((contentPart) => contentPart.text)
      .join("");
  }

  return "";
}

function isBuildRequest(message: string) {
  const normalized = message.toLowerCase();
  const buildVerbs = ["build", "create", "generate", "implement", "make"];
  const buildTargets = [
    "app",
    "application",
    "project",
    "page",
    "component",
    "feature",
    "website",
  ];

  return (
    buildVerbs.some((verb) => normalized.includes(verb)) &&
    buildTargets.some((target) => normalized.includes(target))
  );
}

function getLatestAssistantText(
  outputs: Array<{
    type: string;
    role: string;
    content?: unknown;
  }>,
) {
  const textMessage = [...outputs]
    .reverse()
    .find((output) => output.type === "text" && output.role === "assistant");

  if (!textMessage || !textMessage.content) {
    return "";
  }

  return getTextContent(textMessage.content).trim();
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1);
}

function getFileLookupAnswer(
  message: string,
  outputs: Array<{
    type: string;
    role: string;
    content?: unknown;
    tool?: { name?: string };
  }>,
) {
  const normalizedMessage = message.toLowerCase();
  const isSimpleFileNameRequest =
    normalizedMessage.includes("name of file") ||
    normalizedMessage.includes("file name") ||
    normalizedMessage.includes("filename");

  if (!isSimpleFileNameRequest) {
    return "";
  }

  const listFilesResult = [...outputs]
    .reverse()
    .find(
      (output) =>
        output.type === "tool_result" && output.tool?.name === "listFiles",
    );

  if (!listFilesResult) {
    return "";
  }

  const files = parseJson<
    Array<{ name: string; type: "file" | "folder"; parentId: string | null }>
  >(listFilesResult.content);

  if (!files?.length) {
    return "";
  }

  const fileNames = files
    .filter((file) => file.type === "file")
    .map((file) => file.name);

  if (fileNames.length === 0) {
    return "";
  }

  if (fileNames.length === 1) {
    return fileNames[0]!;
  }

  return fileNames.join("\n");
}

function getToolResultSummary(
  outputs: Array<{
    type: string;
    content?: unknown;
    tool?: { name?: string };
  }>,
) {
  const relevantToolResults = outputs.filter(
    (output) =>
      output.type === "tool_result" &&
      typeof output.content === "string" &&
      ["createFiles", "createFolder", "updateFile", "renameFile", "deleteFiles"].includes(
        output.tool?.name ?? "",
      ),
  );

  if (relevantToolResults.length === 0) {
    return "";
  }

  const messages = relevantToolResults
    .map((output) => String(output.content).trim())
    .filter(Boolean);

  if (messages.length === 0) {
    return "";
  }

  const failedMessages = messages.filter((message) =>
    /^error[:\s]/i.test(message),
  );

  if (failedMessages.length === messages.length) {
    return failedMessages.join("\n");
  }

  return messages.join("\n");
}

function isSimpleFileNameRequest(message: string) {
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("name of file") ||
    normalizedMessage.includes("file name") ||
    normalizedMessage.includes("filename")
  );
}

function isProjectFileListRequest(message: string) {
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("what files") ||
    normalizedMessage.includes("which files") ||
    normalizedMessage.includes("list files") ||
    normalizedMessage.includes("show files") ||
    normalizedMessage.includes("files do i have") ||
    normalizedMessage.includes("file in this project") ||
    normalizedMessage.includes("files in this project")
  );
}

function isGenericAssistantResponse(response: string) {
  const normalizedResponse = response.trim().toLowerCase();

  return (
    normalizedResponse === "" ||
    normalizedResponse ===
      "i processed your request. let me know if you need anything else!" ||
    normalizedResponse ===
      "i could not produce a final answer from the tool results. please try again."
  );
}

function containsRawToolMarkup(response: string) {
  const normalizedResponse = response.toLowerCase();

  return (
    normalizedResponse.includes("<tool_call") ||
    normalizedResponse.includes("</tool_call>") ||
    normalizedResponse.includes("function=execute_command") ||
    normalizedResponse.includes("function=list_files") ||
    normalizedResponse.includes("function=listfiles")
  );
}

function extractExecuteCommand(response: string) {
  const match = response.match(
    /<parameter=command>\s*([\s\S]*?)(?:<\/tool_call>|<parameter=|$)/i,
  );

  return match?.[1]?.trim() || null;
}

function sanitizePathLabel(rawLabel: string) {
  return rawLabel
    .trim()
    .replace(/^[-*#>\s]+/, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^file:\s*/i, "")
    .trim();
}

function looksLikeFilePath(value: string) {
  const normalized = sanitizePathLabel(value);
  if (!normalized || normalized.length > 200) return false;
  if (normalized.includes(" ")) return false;
  if (!normalized.includes(".")) return false;
  if (/^(bash|sh|shell|json|js|ts|tsx|jsx|css|html|md)$/i.test(normalized)) {
    return false;
  }

  return /^(?:[\w@.-]+\/)*[\w@.-]+\.[\w.-]+$/.test(normalized);
}

function parseProjectPlan(value: string) {
  const jsonPayload = extractJsonObject(value);
  if (!jsonPayload) return null;

  const parsed = parseJson<ProjectPlan>(jsonPayload);
  if (!parsed?.files?.length) return null;

  const files = parsed.files.filter(
    (file): file is ExtractedFile =>
      typeof file?.path === "string" &&
      typeof file?.content === "string" &&
      looksLikeFilePath(file.path),
  );

  if (files.length === 0) return null;

  return {
    files,
    settings: parsed.settings,
    summary: parsed.summary,
  };
}

function extractFilesFromMarkdown(response: string) {
  const files: ExtractedFile[] = [];
  const matches = [...response.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];

  for (const match of matches) {
    const blockContent = match[1]?.replace(/\r\n/g, "\n") ?? "";
    if (!blockContent.trim()) continue;

    const blockStart = match.index ?? 0;
    const prefix = response.slice(0, blockStart);
    const previousLines = prefix.split(/\r?\n/).slice(-4).reverse();
    const pathLine = previousLines.find((line) => looksLikeFilePath(line));

    if (!pathLine) continue;

    const path = sanitizePathLabel(pathLine);
    if (!looksLikeFilePath(path)) continue;

    files.push({
      path,
      content: blockContent,
    });
  }

  const deduped = new Map<string, string>();
  for (const file of files) {
    deduped.set(file.path, file.content);
  }

  return [...deduped.entries()].map(([path, content]) => ({ path, content }));
}

async function applyExtractedFiles(params: {
  internalKey: string;
  projectId: Id<"projects">;
  files: ExtractedFile[];
}) {
  const { internalKey, projectId, files } = params;
  if (files.length === 0) return [];

  const projectFiles = await convex.query(api.system.getProjectFiles, {
    internalKey,
    projectId,
  });

  const folderCache = new Map<string, Id<"files"> | undefined>();
  const createdOrUpdated: string[] = [];

  const getOrCreateParentId = async (folderPath: string) => {
    if (!folderPath) return undefined;
    if (folderCache.has(folderPath)) {
      return folderCache.get(folderPath);
    }

    const parentId = await ensureFolderPath({
      internalKey,
      projectId,
      pathSegments: normalizePathSegments(folderPath),
    });
    folderCache.set(folderPath, parentId);
    return parentId;
  };

  for (const file of files) {
    const pathSegments = normalizePathSegments(file.path);
    const fileName = pathSegments.at(-1);
    if (!fileName) continue;

    const folderPath = pathSegments.slice(0, -1).join("/");
    const parentId = await getOrCreateParentId(folderPath);

    const existingFile = projectFiles.find(
      (projectFile) =>
        projectFile.type === "file" &&
        projectFile.parentId === parentId &&
        projectFile.name === fileName,
    );

    if (existingFile) {
      await convex.mutation(api.system.updateFile, {
        internalKey,
        fileId: existingFile._id,
        content: file.content,
      });
      createdOrUpdated.push(file.path);
      continue;
    }

    await convex.mutation(api.system.createFiles, {
      internalKey,
      projectId,
      parentId,
      files: [{ name: fileName, content: file.content }],
    });
    createdOrUpdated.push(file.path);
  }

  return createdOrUpdated;
}

async function applyProjectPlan(params: {
  internalKey: string;
  projectId: Id<"projects">;
  plan: ProjectPlan;
}) {
  const { internalKey, projectId, plan } = params;

  const writtenPaths = await applyExtractedFiles({
    internalKey,
    projectId,
    files: plan.files,
  });

  if (
    plan.settings &&
    (plan.settings.installCommand || plan.settings.devCommand)
  ) {
    await convex.mutation(api.system.updateProjectSettings, {
      internalKey,
      projectId,
      settings: {
        installCommand: plan.settings.installCommand,
        devCommand: plan.settings.devCommand,
      },
    });
  }

  return writtenPaths;
}

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

async function executeRawCommand(params: {
  command: string;
  internalKey: string;
  projectId: Id<"projects">;
}) {
  const { command, internalKey, projectId } = params;
  const trimmedCommand = command.trim();

  const mkdirMatch = trimmedCommand.match(/^(mkdir|md)\s+(.+)$/i);
  if (mkdirMatch) {
    const rawPath = mkdirMatch[2]?.trim();
    if (!rawPath) {
      return null;
    }

    const pathSegments = normalizePathSegments(rawPath);
    if (pathSegments.length === 0) {
      return null;
    }

    await ensureFolderPath({
      internalKey,
      projectId,
      pathSegments,
    });

    return `Created folder "${pathSegments.join("/")}".`;
  }

  const touchMatch = trimmedCommand.match(/^touch\s+(.+)$/i);
  if (touchMatch) {
    const rawPath = touchMatch[1]?.trim();
    if (!rawPath) {
      return null;
    }

    const pathSegments = normalizePathSegments(rawPath);
    const fileName = pathSegments.at(-1);

    if (!fileName) {
      return null;
    }

    const folderSegments = pathSegments.slice(0, -1);
    const parentId =
      folderSegments.length > 0
        ? await ensureFolderPath({
            internalKey,
            projectId,
            pathSegments: folderSegments,
          })
        : undefined;

    const projectFiles = await convex.query(api.system.getProjectFiles, {
      internalKey,
      projectId,
    });

    const existingFile = projectFiles.find(
      (file) =>
        file.type === "file" &&
        file.parentId === parentId &&
        file.name === fileName,
    );

    if (!existingFile) {
      await convex.mutation(api.system.createFiles, {
        internalKey,
        projectId,
        parentId,
        files: [{ name: fileName, content: "" }],
      });
    }

    return `Created file "${pathSegments.join("/")}".`;
  }

  return null;
}

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId } = event.data.event.data as MessageEvent;
      const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

      if (internalKey) {
        await step.run("update-message-on-failure", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content:
              "My apologies, I encountered an error while processing your request. Let me know if you need anything else!",
          });
        });
      }
    },
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const { messageId, conversationId, projectId, message } =
      event.data as MessageEvent;

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      throw new NonRetriableError(
        "POLARIS_CONVEX_INTERNAL_KEY is not configured",
      );
    }

    await step.sleep("wait-for-db-sync", "1s");

    const conversation = await step.run("get-conversation", async () => {
      return await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId,
      });
    });

    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    const recentMessages = await step.run("get-recent-messages", async () => {
      return await convex.query(api.system.getRecentMessages, {
        internalKey,
        conversationId,
        limit: 10,
      });
    });

    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    const contextMessages = recentMessages.filter(
      (msg) => msg._id !== messageId && msg.content.trim() !== "",
    );

    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");

      systemPrompt += `\n\n## Previous Conversation (for context only - do NOT repeat these responses):\n${historyText}\n\n## Current Request:\nRespond ONLY to the user's new message below. Do not repeat or reference your previous responses.`;
    }

    if (conversation.title === DEFAULT_CONVERSATION_TITLE) {
      const titleAgent = createAgent({
        name: "title-generator",
        system: TITLE_GENERATOR_SYSTEM_PROMPT,
        model: getAgentTextModel(DEFAULT_MODEL, {
          temperature: 0,
          max_completion_tokens: 50,
        }),
      });

      const { output } = await titleAgent.run(message, { step });
      const title = getLatestAssistantText(output);

      if (title) {
        await step.run("update-conversation-title", async () => {
          await convex.mutation(api.system.updateConversationTitle, {
            internalKey,
            conversationId,
            title,
          });
        });
      }
    }

    const codingAgent = createAgent({
      name: "polaris",
      description: "An expert AI coding assistant",
      system: systemPrompt,
      model: getAgentTextModel(DEFAULT_MODEL, {
        temperature: 0.3,
        max_completion_tokens: 16000,
      }),
      tools: [
        createListFilesTool({ internalKey, projectId }),
        createReadFilesTool({ internalKey }),
        createUpdateFileTool({ internalKey }),
        createCreateFilesTool({ projectId, internalKey }),
        createCreateFolderTool({ projectId, internalKey }),
        createRenameFileTool({ internalKey }),
        createDeleteFilesTool({ internalKey }),
        createScrapeUrlsTool(),
      ],
    });

    const network = createNetwork({
      name: "polaris-network",
      agents: [codingAgent],
      maxIter: 20,
      router: ({ network }) => {
        const lastResult = network.state.results.at(-1);
        const hasToolCalls = lastResult?.output.some(
          (output) => output.type === "tool_call",
        );

        if (!hasToolCalls) {
          return undefined;
        }

        return codingAgent;
      },
    });

    const result = await network.run(message);
    const allOutputs = result.state.results.flatMap((resultItem) => [
      ...resultItem.output,
      ...resultItem.toolCalls,
    ]);

    let assistantResponse =
      getFileLookupAnswer(message, allOutputs) ||
      getToolResultSummary(allOutputs) ||
      getLatestAssistantText(allOutputs);

    if (!assistantResponse) {
      const fallbackAgent = createAgent({
        name: "polaris-finalizer",
        system: `You are Polaris. Produce the final user-facing answer from the tool activity below.

Return a direct answer to the user's request.
If the tools were insufficient or failed, explain the limitation clearly.
Do not mention internal agent loops or hidden reasoning.`,
        model: getAgentTextModel(DEFAULT_MODEL, {
          temperature: 0,
          max_completion_tokens: 1200,
        }),
      });

      const toolSummary = allOutputs
        .map((output) => {
          if (output.type === "text" && output.content) {
            return `${output.role.toUpperCase()}: ${getTextContent(output.content)}`;
          }

          if (output.type === "tool_call") {
            return `TOOL_CALL: ${JSON.stringify(output.tools)}`;
          }

          if (output.type === "tool_result") {
            return `TOOL_RESULT: ${JSON.stringify(output.content)}`;
          }

          return "";
        })
        .filter(Boolean)
        .join("\n\n");

      const { output } = await fallbackAgent.run(
        `User request:\n${message}\n\nExecution trace:\n${toolSummary}`,
        { step },
      );

      assistantResponse = getLatestAssistantText(output);
    }

    if (!assistantResponse) {
      assistantResponse =
        "I could not produce a final answer from the tool results. Please try again.";
    }

    const hasWriteToolResults = allOutputs.some(
      (output) =>
        output.type === "tool_result" &&
        ["createFiles", "updateFile", "createFolder"].includes(
          output.tool?.name ?? "",
        ),
    );

    const extractedFiles = extractFilesFromMarkdown(assistantResponse);
    if (extractedFiles.length > 0 && !hasWriteToolResults) {
      const writtenPaths = await step.run("apply-extracted-files", async () => {
        return await applyExtractedFiles({
          internalKey,
          projectId,
          files: extractedFiles,
        });
      });

      if (writtenPaths.length > 0) {
        assistantResponse = `Created project files from the generated code example: ${writtenPaths.join(", ")}. Preview can now run using those files.`;
      }
    }

    if (
      isBuildRequest(message) &&
      !hasWriteToolResults &&
      extractedFiles.length === 0
    ) {
      const plannerAgent = createAgent({
        name: "polaris-project-planner",
        system: `You are Polaris.

Return only valid JSON with this shape:
{
  "files": [
    { "path": "package.json", "content": "..." }
  ],
  "settings": {
    "installCommand": "optional",
    "devCommand": "optional"
  },
  "summary": "short summary"
}

Rules:
- Respond with JSON only. No markdown fences.
- Produce real project files for the user's request.
- Prefer a browser-previewable app.
- If the user specifies React + Vite, generate a minimal runnable Vite project with the required files.
- Include only text files.
- Every file must include its full path.`,
        model: getAgentTextModel(DEFAULT_MODEL, {
          temperature: 0,
          max_completion_tokens: 8000,
        }),
      });

      const { output } = await plannerAgent.run(message, { step });
      const plannerResponse = getLatestAssistantText(output);
      const plan = parseProjectPlan(plannerResponse);

      if (plan) {
        const writtenPaths = await step.run("apply-project-plan", async () => {
          return await applyProjectPlan({
            internalKey,
            projectId,
            plan,
          });
        });

        if (writtenPaths.length > 0) {
          assistantResponse =
            plan.summary?.trim() ||
            `Created project files from a structured project plan: ${writtenPaths.join(", ")}. Preview can now run using those files.`;
        }
      }
    }

    if (containsRawToolMarkup(assistantResponse)) {
      const command = extractExecuteCommand(assistantResponse);

      if (command) {
        const executionResult = await step.run("execute-raw-command-fallback", async () => {
          return await executeRawCommand({
            command,
            internalKey,
            projectId,
          });
        });

        if (executionResult) {
          assistantResponse = executionResult;
        }
      }
    }

    if (
      (isSimpleFileNameRequest(message) || isProjectFileListRequest(message)) &&
      (isGenericAssistantResponse(assistantResponse) ||
        containsRawToolMarkup(assistantResponse))
    ) {
      const projectFiles = await step.run("get-project-files-fallback", async () => {
        return await convex.query(api.system.getProjectFiles, {
          internalKey,
          projectId,
        });
      });

      const fileNames = projectFiles
        .filter((file) => file.type === "file")
        .map((file) => file.name);

      if (fileNames.length > 0) {
        if (isSimpleFileNameRequest(message)) {
          assistantResponse =
            fileNames.length === 1 ? fileNames[0]! : fileNames.join("\n");
        } else {
          assistantResponse = fileNames.join("\n");
        }
      }
    }

    await step.run("update-assistant-message", async () => {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: assistantResponse,
      });
    });

    return { success: true, messageId, conversationId };
  },
);
