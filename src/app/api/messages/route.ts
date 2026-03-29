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

function shouldCreateReactTodoApp(message: string) {
  const normalized = message.toLowerCase();

  return (
    (normalized.includes("vite") && normalized.includes("react")) ||
    normalized.includes("todo") ||
    normalized.includes("to do") ||
    normalized.includes("simple project")
  );
}

async function scaffoldReactTodoApp(params: {
  internalKey: string;
  projectId: Id<"projects">;
  assistantMessageId: Id<"messages">;
}) {
  const { internalKey, projectId, assistantMessageId } = params;

  const projectFiles = await convex.query(api.system.getProjectFiles, {
    internalKey,
    projectId,
  });

  if (projectFiles.length > 0) {
    await convex.mutation(api.system.updateMessageContent, {
      internalKey,
      messageId: assistantMessageId,
      content:
        'This project already contains files. Clear it first or ask me to update the existing app instead.',
    });
    return;
  }

  const srcFolderId = await convex.mutation(api.system.createFolder, {
    internalKey,
    projectId,
    name: "src",
  });

  await convex.mutation(api.system.createFiles, {
    internalKey,
    projectId,
    files: [
      {
        name: "package.json",
        content: JSON.stringify(
          {
            name: "todo-app",
            private: true,
            version: "0.0.0",
            type: "module",
            scripts: {
              dev: "vite --host 0.0.0.0 --port 4173",
              build: "vite build",
              preview: "vite preview --host 0.0.0.0 --port 4173",
            },
            dependencies: {
              react: "^19.0.0",
              "react-dom": "^19.0.0",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
          },
          null,
          2,
        ),
      },
      {
        name: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todo App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
      },
    ],
  });

  await convex.mutation(api.system.createFiles, {
    internalKey,
    projectId,
    parentId: srcFolderId,
    files: [
      {
        name: "main.jsx",
        content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      },
      {
        name: "App.jsx",
        content: `import React, { useState } from "react";

const initialTodos = [
  { id: 1, text: "Create the first task", done: true },
  { id: 2, text: "Style the interface", done: false },
];

export default function App() {
  const [todos, setTodos] = useState(initialTodos);
  const [value, setValue] = useState("");

  const addTodo = (event) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;

    setTodos((current) => [
      { id: Date.now(), text, done: false },
      ...current,
    ]);
    setValue("");
  };

  const toggleTodo = (id) => {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo,
      ),
    );
  };

  const remaining = todos.filter((todo) => !todo.done).length;

  return (
    <main className="app-shell">
      <section className="todo-card">
        <p className="eyebrow">Vite + React</p>
        <h1>Todo Application</h1>
        <p className="subtitle">
          A simple starter app that writes code into the editor and shows the
          running result in preview.
        </p>

        <form className="todo-form" onSubmit={addTodo}>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Add a new task"
          />
          <button type="submit">Add task</button>
        </form>

        <div className="todo-meta">
          <span>{remaining} task(s) remaining</span>
          <span>{todos.length} total</span>
        </div>

        <ul className="todo-list">
          {todos.map((todo) => (
            <li key={todo.id} className={todo.done ? "done" : ""}>
              <label>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => toggleTodo(todo.id)}
                />
                <span>{todo.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
`,
      },
      {
        name: "styles.css",
        content: `:root {
  color-scheme: dark;
  font-family: Inter, system-ui, sans-serif;
  background:
    radial-gradient(circle at top, rgba(118, 174, 255, 0.3), transparent 35%),
    linear-gradient(180deg, #12141d, #0b0d12 60%);
  color: #f4f7fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

button,
input {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.todo-card {
  width: min(100%, 560px);
  padding: 28px;
  border-radius: 24px;
  background: rgba(12, 14, 20, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(16px);
}

.eyebrow {
  margin: 0 0 10px;
  color: #8ab4ff;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: clamp(32px, 6vw, 48px);
}

.subtitle {
  margin: 12px 0 0;
  color: rgba(244, 247, 251, 0.72);
  line-height: 1.6;
}

.todo-form {
  margin-top: 24px;
  display: flex;
  gap: 12px;
}

.todo-form input {
  flex: 1;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: white;
  border-radius: 14px;
  padding: 14px 16px;
}

.todo-form button {
  border: 0;
  border-radius: 14px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #8ab4ff, #5c7cff);
  color: #08111f;
  font-weight: 700;
}

.todo-meta {
  margin-top: 18px;
  display: flex;
  justify-content: space-between;
  color: rgba(244, 247, 251, 0.7);
  font-size: 14px;
}

.todo-list {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.todo-list li {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.todo-list li.done span {
  text-decoration: line-through;
  color: rgba(244, 247, 251, 0.45);
}

.todo-list label {
  display: flex;
  align-items: center;
  gap: 12px;
}

@media (max-width: 640px) {
  .todo-card {
    padding: 22px;
  }

  .todo-form {
    flex-direction: column;
  }
}
`,
      },
    ],
  });

  await convex.mutation(api.system.updateMessageContent, {
    internalKey,
    messageId: assistantMessageId,
    content:
      'Created a runnable Vite + React todo app with "package.json", "index.html", and files in "src". The terminal will install dependencies and start the dev server for preview.',
  });
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

  if (shouldCreateReactTodoApp(message)) {
    try {
      await scaffoldReactTodoApp({
        internalKey,
        projectId,
        assistantMessageId,
      });

      return NextResponse.json({
        success: true,
        messageId: assistantMessageId,
        direct: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to scaffold app";

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
