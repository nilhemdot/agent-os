// Local-only history of SEO generate sessions + Netlify deploys.
// Persisted to ~/.agentic-os/seo-history.json. Append-only with a rolling cap.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HISTORY_FILE = path.join(os.homedir(), ".agentic-os", "seo-history.json");
const MAX_ENTRIES = 200;

export interface ArticleWritten {
  siteId: string;
  filePath: string;
  liveUrl?: string;
}

export interface GenerateSession {
  id: string;
  createdAt: number;
  finishedAt?: number;
  keyword: string;
  slug: string;
  transcriptSource: string; // slug | "(pasted)" | "(none)"
  status: "running" | "completed" | "failed" | "aborted";
  articles: ArticleWritten[];
  exitCode?: number;
}

export interface DeployEvent {
  id: string;
  startedAt: number;
  finishedAt?: number;
  siteId: string;
  siteName: string;
  blogBaseUrl: string;
  status: "running" | "ok" | "failed";
  liveSlug?: string;        // most recent post slug deployed
  liveUrl?: string;         // canonical blog URL on the site
  netlifyUrl?: string;      // unique deploy preview URL parsed from netlify CLI output
  durationMs?: number;
  errorTail?: string;
}

interface HistoryFile {
  version: 1;
  sessions: GenerateSession[];
  deploys: DeployEvent[];
}

async function load(): Promise<HistoryFile> {
  if (!existsSync(HISTORY_FILE)) return { version: 1, sessions: [], deploys: [] };
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as HistoryFile;
    if (!parsed.version) return { version: 1, sessions: [], deploys: [] };
    return parsed;
  } catch { return { version: 1, sessions: [], deploys: [] }; }
}

async function save(data: HistoryFile): Promise<void> {
  await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  // Rolling cap to keep file small
  data.sessions = data.sessions.slice(-MAX_ENTRIES);
  data.deploys = data.deploys.slice(-MAX_ENTRIES);
  await writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ─── Sessions ──────────────────────────────────────────────────────
export async function startSession(input: { keyword: string; slug: string; transcriptSource: string }): Promise<GenerateSession> {
  const data = await load();
  const s: GenerateSession = {
    id: newId(),
    createdAt: Date.now(),
    keyword: input.keyword,
    slug: input.slug,
    transcriptSource: input.transcriptSource,
    status: "running",
    articles: [],
  };
  data.sessions.push(s);
  await save(data);
  return s;
}

export async function appendArticle(sessionId: string, article: ArticleWritten): Promise<void> {
  const data = await load();
  const s = data.sessions.find((x) => x.id === sessionId);
  if (!s) return;
  // De-dupe by filePath
  if (!s.articles.some((a) => a.filePath === article.filePath)) {
    s.articles.push(article);
    await save(data);
  }
}

export async function finishSession(sessionId: string, status: "completed" | "failed" | "aborted", exitCode?: number): Promise<void> {
  const data = await load();
  const s = data.sessions.find((x) => x.id === sessionId);
  if (!s) return;
  s.status = status;
  s.finishedAt = Date.now();
  if (typeof exitCode === "number") s.exitCode = exitCode;
  await save(data);
}

// ─── Deploys ───────────────────────────────────────────────────────
export async function startDeploy(input: { siteId: string; siteName: string; blogBaseUrl: string; liveSlug?: string }): Promise<DeployEvent> {
  const data = await load();
  const d: DeployEvent = {
    id: newId(),
    startedAt: Date.now(),
    siteId: input.siteId,
    siteName: input.siteName,
    blogBaseUrl: input.blogBaseUrl,
    status: "running",
    liveSlug: input.liveSlug,
    liveUrl: input.liveSlug ? `${input.blogBaseUrl}/blog/${input.liveSlug}/` : undefined,
  };
  data.deploys.push(d);
  await save(data);
  return d;
}

export async function finishDeploy(deployId: string, fields: { status: "ok" | "failed"; netlifyUrl?: string; errorTail?: string }): Promise<void> {
  const data = await load();
  const d = data.deploys.find((x) => x.id === deployId);
  if (!d) return;
  d.status = fields.status;
  d.finishedAt = Date.now();
  d.durationMs = d.finishedAt - d.startedAt;
  if (fields.netlifyUrl) d.netlifyUrl = fields.netlifyUrl;
  if (fields.errorTail) d.errorTail = fields.errorTail;
  await save(data);
}

// ─── Read ──────────────────────────────────────────────────────────
export async function getHistory(): Promise<{ sessions: GenerateSession[]; deploys: DeployEvent[] }> {
  const data = await load();
  return {
    sessions: data.sessions.slice().reverse(),
    deploys: data.deploys.slice().reverse(),
  };
}
