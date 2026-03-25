import { generateText } from "ai";
import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { getTextModel, parseModelError } from "@/lib/model";
import { api } from "../../../../convex/_generated/api";
import { CODING_AGENT_SYSTEM_PROMPT } from "./constants";
// import { createReadFilesTool } from './tools/read-files';
// import { createListFilesTool } from './tools/list-files';
// import { createUpdateFileTool } from './tools/update-file';
// import { createCreateFilesTool } from './tools/create-files';
// import { createCreateFolderTool } from './tools/create-folder';
// import { createRenameFileTool } from './tools/rename-file';
// import { createDeleteFilesTool } from './tools/delete-files';
// import { createScrapeUrlsTool } from './tools/scrape-urls';

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
}

export async function processConversationMessage({
  messageId,
  conversationId,
  message,
}: Pick<MessageEvent, "messageId" | "conversationId" | "message">) {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    throw new NonRetriableError(
      "POLARIS_CONVEX_INTERNAL_KEY is not configured",
    );
  }

  const conversation = await convex.query(api.system.getConversationById, {
    internalKey,
    conversationId,
  });

  if (!conversation) {
    throw new NonRetriableError("Conversation not found");
  }

  const recentMessages = await convex.query(api.system.getRecentMessages, {
    internalKey,
    conversationId,
    limit: 10,
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

  const prompt = `${systemPrompt}\n\nUSER: ${message}`;

  try {
    const result = await generateText({
      model: getTextModel(),
      prompt,
    });

    const latestMessages = await convex.query(api.system.getRecentMessages, {
      internalKey,
      conversationId,
      limit: 20,
    });

    const currentMessage = latestMessages.find((msg) => msg._id === messageId);
    if (currentMessage?.status === "cancelled") {
      return { success: false, cancelled: true };
    }

    await convex.mutation(api.system.updateMessageContent, {
      internalKey,
      messageId,
      content:
        result.text.trim() ||
        "I processed your request, but the model returned an empty response.",
    });

    return { success: true, cancelled: false };
  } catch (error) {
    const parsedError = parseModelError(error);

    const latestMessages = await convex.query(api.system.getRecentMessages, {
      internalKey,
      conversationId,
      limit: 20,
    });

    const currentMessage = latestMessages.find((msg) => msg._id === messageId);
    if (currentMessage?.status !== "cancelled") {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: parsedError.message,
      });
    }

    throw error;
  }
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

      // Update the message with error content
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
    const { messageId, conversationId, message } = event.data as MessageEvent;

    await step.run("process-conversation-message", async () => {
      return await processConversationMessage({
        messageId,
        conversationId,
        message,
      });
    });

    return { success: true, messageId, conversationId };
  },
);
