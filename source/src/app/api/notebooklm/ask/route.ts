import { NextResponse } from "next/server";
import { callTool } from "@/lib/notebooklmClient";
import { writeFile, readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAULT = path.join(os.homedir(), "Documents", "Obsidian Vault", "Agentic OS", "Notebooks");

async function logChat(notebookName: string | undefined, question: string, answer: string): Promise<void> {
  try {
    const safeName = (notebookName || "default").replace(/[^A-Za-z0-9 _-]/g, "_").slice(0, 60);
    const dir = path.join(VAULT, safeName);
    await mkdir(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `chat-${day}.md`);
    const exists = await stat(file).then(() => true).catch(() => false);
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const header = exists ? "" : `---\ntags: [notebooklm, ${safeName}, ${day}]\nnotebook: ${safeName}\ndate: ${day}\n---\n\n# 📔 ${safeName} — ${day}\n\n`;
    const block = `## ${time}\n\n**You:** ${question}\n\n**NotebookLM:** ${answer}\n\n---\n\n`;
    const existing = exists ? await readFile(file, "utf8") : "";
    await writeFile(file, existing + header + block, "utf8");
  } catch { /* logging is best-effort */ }
}

export async function POST(req: Request) {
  try {
    const { question, notebook_id, notebook_name } = await req.json();
    if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
    if (!notebook_id) return NextResponse.json({ error: "notebook_id required" }, { status: 400 });

    // New MCP uses notebook_query (not ask_question). No session_id concept — each call is independent.
    const result = await callTool<{ answer?: string; response?: string }>("notebook_query", {
      notebook_id,
      query: question,
    });
    const answer = result?.answer ?? result?.response ?? "";
    if (answer) void logChat(notebook_name, question, answer);
    return NextResponse.json({ ...result, answer });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
