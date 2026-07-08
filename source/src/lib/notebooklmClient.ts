// Singleton MCP client to jacob-bd/notebooklm-mcp-cli. 35 tools — full Studio coverage
// (audio, video, infographic, mind map, slides, flashcards, reports, briefing doc, etc.)
// + download_artifact for pulling any of those back into the dashboard.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "@/lib/config";

// Resolve to THIS user's own install — config handles env var → config.json
// nlmBin → `which notebooklm-mcp` → common locations. Bare "notebooklm-mcp" is
// the last resort (found via PATH at spawn time). Never a hardcoded home path.
const NLM_BIN = config.nlmBin || "notebooklm-mcp";

let clientPromise: Promise<Client> | null = null;

function makeClient(): Promise<Client> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const transport = new StdioClientTransport({ command: NLM_BIN, args: [], env });
  const client = new Client({ name: "agentic-os", version: "0.2.0" });
  return client.connect(transport).then(() => client);
}

export async function getNotebookLM(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = makeClient().catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

/** Reset the cached client — used after re-auth or if the subprocess crashes. */
export async function resetClient(): Promise<void> {
  if (clientPromise) {
    try {
      const c = await clientPromise;
      await c.close().catch(() => {});
    } catch {}
  }
  clientPromise = null;
}

type ContentPart = { type?: string; text?: string };

/** Call a tool and return parsed JSON content (with raw fallback). */
export async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = await getNotebookLM();
  const res = await client.callTool({ name, arguments: args });
  const content = (res as { content?: ContentPart[] }).content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (first?.type === "text" && typeof first.text === "string") {
      try { return JSON.parse(first.text) as T; }
      catch { return first.text as unknown as T; }
    }
  }
  return res as T;
}
