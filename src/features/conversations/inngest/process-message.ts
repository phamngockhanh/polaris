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
    normalizedResponse.includes("function=list_files") ||
    normalizedResponse.includes("function=listfiles")
  );
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
