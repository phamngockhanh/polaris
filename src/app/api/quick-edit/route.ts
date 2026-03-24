import { generateText } from "ai";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { firecrawl } from "@/lib/firecrawl";
import { getTextModel, parseModelError } from "@/lib/model";

const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;
const MAX_FULL_CODE_CONTEXT_CHARS = 12000;
const MAX_DOC_CONTEXT_CHARS = 6000;
const IDENTIFIER_REGEX = /^[A-Za-z_$][\w$]*$/;
const quickEditRequestSchema = z.object({
  selectedCode: z.string().min(1),
  fullCode: z.string().default(""),
  instruction: z.string().min(1),
});

const QUICK_EDIT_PROMPT = `You are a code editing assistant. Edit the selected code based on the user's instruction.

<context>
<selected_code>
{selectedCode}
</selected_code>
<full_code_context>
{fullCode}
</full_code_context>
</context>

{documentation}

<instruction>
{instruction}
</instruction>

<instructions>
Return ONLY the edited version of the selected code.
Maintain the same indentation level as the original.
Do not include any explanations or comments unless requested.
If the instruction is unclear or cannot be applied, return the original code unchanged.
</instructions>`;

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function extractRelevantCodeContext(fullCode: string, selectedCode: string) {
  if (!fullCode) {
    return "";
  }

  if (fullCode.length <= MAX_FULL_CODE_CONTEXT_CHARS) {
    return fullCode;
  }

  const selectionIndex = fullCode.indexOf(selectedCode);
  if (selectionIndex === -1) {
    return clampText(fullCode, MAX_FULL_CODE_CONTEXT_CHARS);
  }

  const contextRadius = Math.floor(
    (MAX_FULL_CODE_CONTEXT_CHARS - selectedCode.length) / 2,
  );
  const start = Math.max(0, selectionIndex - contextRadius);
  const end = Math.min(
    fullCode.length,
    selectionIndex + selectedCode.length + contextRadius,
  );

  const prefix = start > 0 ? "[truncated]\n" : "";
  const suffix = end < fullCode.length ? "\n[truncated]" : "";

  return `${prefix}${fullCode.slice(start, end)}${suffix}`;
}

function tryParseRenameInstruction(selectedCode: string, instruction: string) {
  const trimmedSelection = selectedCode.trim();
  if (!IDENTIFIER_REGEX.test(trimmedSelection)) {
    return null;
  }

  const renameMatch = instruction.match(
    /\brename\b[\s\S]*?\bto\b\s*["'`]?([A-Za-z_$][\w$]*)["'`]?/i,
  );

  if (!renameMatch) {
    return null;
  }

  const nextIdentifier = renameMatch[1];
  if (!nextIdentifier || nextIdentifier === trimmedSelection) {
    return trimmedSelection;
  }

  return nextIdentifier;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    const body = quickEditRequestSchema.safeParse(await request.json());

    if (!userId && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid quick edit payload" },
        { status: 400 },
      );
    }

    const selectedCode = body.data.selectedCode.trim();
    const fullCode = body.data.fullCode;
    const instruction = body.data.instruction.trim();

    const directRename = tryParseRenameInstruction(selectedCode, instruction);
    if (directRename) {
      return NextResponse.json({ editedCode: directRename });
    }

    const urls: string[] = instruction.match(URL_REGEX) || [];
    let documentationContext = "";

    if (urls.length > 0) {
      const scrapedResults = await Promise.all(
        urls.map(async (url) => {
          try {
            const result = await firecrawl.scrape(url, {
              formats: ["markdown"],
            });

            if (result.markdown) {
              return `<doc url="${url}">\n${result.markdown}\n</doc>`;
            }

            return null;
          } catch {
            return null;
          }
        }),
      );

      const validResults = scrapedResults.filter(Boolean);

      if (validResults.length > 0) {
        documentationContext = `<documentation>\n${clampText(validResults.join("\n\n"), MAX_DOC_CONTEXT_CHARS)}\n</documentation>`;
      }
    }

    const relevantFullCode = extractRelevantCodeContext(
      fullCode || "",
      selectedCode,
    );

    const prompt = QUICK_EDIT_PROMPT.replace("{selectedCode}", selectedCode)
      .replace("{fullCode}", relevantFullCode)
      .replace("{instruction}", instruction)
      .replace("{documentation}", documentationContext);

    const result = await generateText({
      model: getTextModel(),
      prompt,
    });

    const editedCode = result.text.trim() || selectedCode;

    return NextResponse.json({ editedCode });
  } catch (error) {
    const parsedError = parseModelError(error);
    console.error("Edit error:", parsedError);
    return NextResponse.json(
      { error: parsedError.message, details: parsedError },
      { status: parsedError.status || 500 },
    );
  }
}
