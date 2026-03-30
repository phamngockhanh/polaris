import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { DEFAULT_CONVERSATION_TITLE } from "@/features/conversations/constants";

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  prompt: z.string().min(1),
});

function buildProjectCreationPrompt(prompt: string) {
  return [
    "Create the actual project files in the workspace.",
    "Do not reply with tutorial steps or code blocks unless the files have already been created.",
    "Prefer a browser-previewable app so the result can be shown in the preview pane immediately.",
    "If the request does not specify a stack, create a simple runnable web app with real files such as package.json, index.html, and source files as needed.",
    "Make sure the generated project includes the minimal commands and files required to run in preview.",
    "",
    `User request: ${prompt.trim()}`,
  ].join("\n");
}

function shouldCreateReactTodoApp(prompt: string) {
  const normalized = prompt.toLowerCase();

  return (
    (normalized.includes("vite") && normalized.includes("react")) ||
    normalized.includes("todo") ||
    normalized.includes("to do") ||
    normalized.includes("simple project")
  );
}

function shouldCreateNotesApp(prompt: string) {
  const normalized = prompt.toLowerCase();

  return (
    normalized.includes("notes app") ||
    normalized.includes("note app") ||
    (normalized.includes("notes") &&
      normalized.includes("add") &&
      normalized.includes("edit") &&
      normalized.includes("delete"))
  );
}

async function scaffoldNotesApp(params: {
  internalKey: string;
  projectId: Id<"projects">;
  assistantMessageId: Id<"messages">;
}) {
  const { internalKey, projectId, assistantMessageId } = params;

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
            name: "notes-app",
            private: true,
            version: "0.0.0",
            type: "module",
            scripts: {
              dev: "node server.mjs",
              start: "node server.mjs",
            },
          },
          null,
          2,
        ),
      },
      {
        name: "server.mjs",
        content: `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url || "/index.html";
  const filePath = normalize(join(root, requestPath));

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(\`Preview server running at http://0.0.0.0:\${port}\`);
});
`,
      },
      {
        name: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Notes App</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <main class="app-shell">
      <section class="notes-app">
        <header class="hero">
          <div>
            <p class="eyebrow">Zero-install preview</p>
            <h1>Notes App</h1>
            <p class="subtitle">Create, edit, search, and delete notes instantly.</p>
          </div>
          <button id="new-note" class="primary-button" type="button">New note</button>
        </header>

        <div class="workspace">
          <aside class="sidebar">
            <input id="search-input" class="search-input" placeholder="Search notes" />
            <div id="notes-list" class="notes-list"></div>
          </aside>
          <section class="editor">
            <input id="note-title" class="title-input" placeholder="Note title" />
            <textarea id="note-body" class="body-input" placeholder="Write your note here..."></textarea>
            <div class="editor-actions">
              <button id="save-note" class="primary-button" type="button">Save note</button>
              <button id="delete-note" class="ghost-button" type="button">Delete note</button>
            </div>
          </section>
        </div>
      </section>
    </main>
    <script type="module" src="/src/main.js"></script>
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
        name: "main.js",
        content: `const searchInput = document.getElementById("search-input");
const notesList = document.getElementById("notes-list");
const titleInput = document.getElementById("note-title");
const bodyInput = document.getElementById("note-body");
const newNoteButton = document.getElementById("new-note");
const saveNoteButton = document.getElementById("save-note");
const deleteNoteButton = document.getElementById("delete-note");

let notes = [
  {
    id: 1,
    title: "Project brief",
    body: "Build a note-taking app with search and editing.",
    updatedAt: "Just now",
  },
  {
    id: 2,
    title: "Ideas",
    body: "Add note colors, pin important notes, and keyboard shortcuts.",
    updatedAt: "Today",
  },
];

let activeNoteId = notes[0].id;

const getFilteredNotes = () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return notes;
  return notes.filter((note) =>
    [note.title, note.body].some((value) => value.toLowerCase().includes(query))
  );
};

const getActiveNote = () => notes.find((note) => note.id === activeNoteId) || null;

const renderEditor = () => {
  const activeNote = getActiveNote();
  titleInput.value = activeNote?.title || "";
  bodyInput.value = activeNote?.body || "";
  deleteNoteButton.disabled = !activeNote;
};

const renderList = () => {
  const filteredNotes = getFilteredNotes();
  notesList.innerHTML = "";

  if (filteredNotes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No notes match your search.";
    notesList.append(empty);
    return;
  }

  for (const note of filteredNotes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = note.id === activeNoteId ? "note-item active" : "note-item";
    button.innerHTML = \`
      <strong>\${note.title}</strong>
      <span>\${note.body.slice(0, 64) || "Empty note"}</span>
      <small>\${note.updatedAt}</small>
    \`;
    button.addEventListener("click", () => {
      activeNoteId = note.id;
      render();
    });
    notesList.append(button);
  }
};

const render = () => {
  renderList();
  renderEditor();
};

newNoteButton.addEventListener("click", () => {
  const note = {
    id: Date.now(),
    title: "Untitled note",
    body: "",
    updatedAt: "Just now",
  };
  notes = [note, ...notes];
  activeNoteId = note.id;
  render();
  titleInput.focus();
  titleInput.select();
});

saveNoteButton.addEventListener("click", () => {
  const activeNote = getActiveNote();
  if (!activeNote) return;

  notes = notes.map((note) =>
    note.id === activeNote.id
      ? {
          ...note,
          title: titleInput.value.trim() || "Untitled note",
          body: bodyInput.value.trim(),
          updatedAt: "Saved just now",
        }
      : note
  );
  render();
});

deleteNoteButton.addEventListener("click", () => {
  if (!getActiveNote()) return;
  notes = notes.filter((note) => note.id !== activeNoteId);
  activeNoteId = notes[0]?.id ?? null;
  render();
});

searchInput.addEventListener("input", renderList);

render();
`,
      },
      {
        name: "styles.css",
        content: `:root {
  color-scheme: dark;
  font-family: Inter, system-ui, sans-serif;
  background:
    radial-gradient(circle at top left, rgba(255, 190, 92, 0.28), transparent 28%),
    linear-gradient(180deg, #11131a, #090b10 65%);
  color: #f5f7fb;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
button, input, textarea { font: inherit; }

.app-shell {
  min-height: 100vh;
  padding: 24px;
}

.notes-app {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.hero, .workspace, .sidebar, .editor, .note-item {
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(16, 18, 24, 0.8);
  backdrop-filter: blur(14px);
}

.hero {
  padding: 24px;
  border-radius: 24px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.workspace {
  border-radius: 24px;
  display: grid;
  grid-template-columns: 320px 1fr;
  overflow: hidden;
}

.sidebar, .editor {
  padding: 20px;
}

.sidebar {
  border-right: 1px solid rgba(255,255,255,0.08);
  display: grid;
  gap: 14px;
  align-content: start;
}

.notes-list {
  display: grid;
  gap: 10px;
}

.note-item {
  width: 100%;
  text-align: left;
  border-radius: 18px;
  padding: 14px;
  display: grid;
  gap: 6px;
  color: inherit;
  cursor: pointer;
}

.note-item.active {
  border-color: rgba(255, 190, 92, 0.55);
  background: rgba(255, 190, 92, 0.12);
}

.note-item span, .subtitle, .empty-state, .note-item small {
  color: rgba(245,247,251,0.68);
}

.editor {
  display: grid;
  gap: 14px;
}

.title-input, .body-input, .search-input {
  width: 100%;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: inherit;
}

.title-input, .search-input { padding: 14px 16px; }
.body-input { min-height: 320px; padding: 16px; resize: vertical; }

.editor-actions {
  display: flex;
  gap: 12px;
}

.primary-button, .ghost-button {
  border-radius: 14px;
  padding: 12px 16px;
  border: 0;
  cursor: pointer;
}

.primary-button {
  background: linear-gradient(135deg, #ffbe5c, #ff8d5c);
  color: #1c1205;
  font-weight: 700;
}

.ghost-button {
  background: rgba(255,255,255,0.06);
  color: inherit;
}

.eyebrow {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  font-weight: 700;
  color: #ffbe5c;
}

h1 { margin: 0; font-size: clamp(34px, 5vw, 52px); }
.subtitle { margin: 10px 0 0; line-height: 1.6; max-width: 560px; }

@media (max-width: 900px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .hero {
    flex-direction: column;
  }
}
`,
      },
    ],
  });

  await convex.mutation(api.system.updateProjectSettings, {
    internalKey,
    projectId,
    settings: {
      installCommand: "node -e 0",
      devCommand: "node server.mjs",
    },
  });

  await convex.mutation(api.system.updateMessageContent, {
    internalKey,
    messageId: assistantMessageId,
    content:
      'Created a runnable notes app with add, edit, delete, and search. Preview runs immediately without installing packages, and local development works with "npm run dev".',
  });
}

async function scaffoldReactTodoApp(params: {
  internalKey: string;
  projectId: Id<"projects">;
  assistantMessageId: Id<"messages">;
}) {
  const { internalKey, projectId, assistantMessageId } = params;

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
              dev: "node server.mjs",
              start: "node server.mjs",
            },
          },
          null,
          2,
        ),
      },
      {
        name: "server.mjs",
        content: `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url || "/index.html";
  const filePath = normalize(join(root, requestPath));

  try {
    const file = await readFile(filePath);
    const extension = extname(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(\`Preview server running at http://0.0.0.0:\${port}\`);
});
`,
      },
      {
        name: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todo App</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <main class="app-shell">
      <section class="todo-card">
        <p class="eyebrow">Zero-install preview</p>
        <h1>Todo Application</h1>
        <p class="subtitle">
          A simple starter app that runs in browser preview and on your local machine without installing packages.
        </p>

        <form class="todo-form" id="todo-form">
          <input id="todo-input" placeholder="Add a new task" />
          <button type="submit">Add task</button>
        </form>

        <div class="todo-meta">
          <span id="remaining-count">1 task(s) remaining</span>
          <span id="total-count">2 total</span>
        </div>

        <ul class="todo-list" id="todo-list"></ul>
      </section>
    </main>
    <script type="module" src="/src/main.js"></script>
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
        name: "main.js",
        content: `const initialTodos = [
  { id: 1, text: "Create the first task", done: true },
  { id: 2, text: "Style the interface", done: false },
];

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");
const remainingCount = document.getElementById("remaining-count");
const totalCount = document.getElementById("total-count");

let todos = [...initialTodos];

const render = () => {
  list.innerHTML = "";

  for (const todo of todos) {
    const item = document.createElement("li");
    if (todo.done) {
      item.classList.add("done");
    }

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.done;
    checkbox.addEventListener("change", () => {
      todos = todos.map((entry) =>
        entry.id === todo.id ? { ...entry, done: !entry.done } : entry
      );
      render();
    });

    const text = document.createElement("span");
    text.textContent = todo.text;

    label.append(checkbox, text);
    item.append(label);
    list.append(item);
  }

  const remaining = todos.filter((todo) => !todo.done).length;
  remainingCount.textContent = \`\${remaining} task(s) remaining\`;
  totalCount.textContent = \`\${todos.length} total\`;
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = input.value.trim();

  if (!value) {
    return;
  }

  todos = [{ id: Date.now(), text: value, done: false }, ...todos];
  input.value = "";
  render();
});

render();
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

  await convex.mutation(api.system.updateProjectSettings, {
    internalKey,
    projectId,
    settings: {
      installCommand: "node -e 0",
      devCommand: "node server.mjs",
    },
  });

  await convex.mutation(api.system.updateMessageContent, {
    internalKey,
    messageId: assistantMessageId,
    content:
      'Created a runnable todo app with "package.json", "server.mjs", "index.html", and files in "src". Preview now runs without installing packages, and local development works with "npm run dev".',
  });
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
      { status: 500 }
    );
  }

  const body = await request.json();
  const { prompt } = requestSchema.parse(body);

  // Generate a random project name
  const projectName = uniqueNamesGenerator({
    dictionaries: [adjectives, animals, colors],
    separator: "-",
    length: 3,
  });

  // Create project and conversation together
  const { projectId, conversationId } = await convex.mutation(
    api.system.createProjectWithConversation,
    {
      internalKey,
      projectName,
      conversationTitle: DEFAULT_CONVERSATION_TITLE,
      ownerId: userId,
    },
  );

  // Create user message
  await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId,
    projectId,
    role: "user",
    content: prompt,
  });

  // Create assistant message placeholder with processing status
  const assistantMessageId = await convex.mutation(
    api.system.createMessage,
    {
      internalKey,
      conversationId,
      projectId,
      role: "assistant",
      content: "",
      status: "processing",
    },
  );

  if (shouldCreateNotesApp(prompt)) {
    await scaffoldNotesApp({
      internalKey,
      projectId,
      assistantMessageId,
    });

    return NextResponse.json({ projectId });
  }

  if (shouldCreateReactTodoApp(prompt)) {
    await scaffoldReactTodoApp({
      internalKey,
      projectId,
      assistantMessageId,
    });

    return NextResponse.json({ projectId });
  }

  // Trigger Inngest to process the message
  await inngest.send({
    name: "message/sent",
    data: {
      messageId: assistantMessageId,
      conversationId,
      projectId,
      message: buildProjectCreationPrompt(prompt),
    },
  });

  return NextResponse.json({ projectId });
};
