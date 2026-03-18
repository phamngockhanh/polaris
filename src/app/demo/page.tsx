// localhost:3000/api/demo/blocking

"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function DemoPage() {
  const [prompt, setPrompt] = useState(
    "Summarize https://nextjs.org/docs and tell me the 3 most important points.",
  );
  const [loading, setLoading] = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [result, setResult] = useState<string>("");

  const handleBlocking = async () => {
    setLoading(true);
    const response = await fetch("/api/demo/blocking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await response.json()) as { text?: string; error?: string };
    setResult(data.text ?? data.error ?? "No response");
    setLoading(false);
  };
  const handleBackground = async () => {
    setLoading2(true);
    const response = await fetch("/api/demo/background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await response.json()) as {
      status?: string;
      error?: string;
    };
    setResult(data.error ?? data.status ?? "No response");
    setLoading2(false);
  };
  return (
    <div className="p-8 space-y-4">
      <textarea
        className="min-h-32 w-full rounded-md border p-3"
        onChange={(event) => setPrompt(event.target.value)}
        value={prompt}
      />
      <div className="space-x-4">
        <Button disabled={loading} onClick={handleBlocking}>
          {loading ? "Loading...." : "Blocking"}
        </Button>
        <Button disabled={loading2} onClick={handleBackground}>
          {loading2 ? "Loading...." : "Background"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap rounded-md border p-3">{result}</pre>
    </div>
  );
}
