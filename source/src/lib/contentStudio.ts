// Content Studio — a content-production kanban board driven by a team of
// GLM-5.2 Hermes profiles (SEO blog team + video team) with a judge loop.
// State + artifacts live under ~/.hermes/content-studio/ and are written by
// the orchestrator (orchestrate.mjs). The dashboard reads this state.

import { readFile, writeFile } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { existsSync } from "node:fs";
import path from "node:path";

export const CONTENT_ROOT = path.join(hermesHome(), "content-studio");
export const STATE_FILE = path.join(CONTENT_ROOT, "state.json");
export const ARTIFACTS_DIR = path.join(CONTENT_ROOT, "artifacts");

export type CardStatus = "todo" | "running" | "done" | "blocked";

export interface CardIteration {
  n: number;
  score: number;
  verdict: string;
  fixes: string[];
}

export interface ContentCard {
  id: string;
  column: string;
  title: string;
  profile: string | null;
  role: string;
  status: CardStatus;
  summary: string | null;
  startedAt: number | null;
  endedAt: number | null;
  iterations?: CardIteration[];
}

export interface BlogArtifact {
  kind: "blog";
  title: string | null;
  slug: string | null;
  previewPath: string | null; // rel path under ARTIFACTS_DIR to built blog HTML
  previewReady: boolean;
  pinned: boolean;
  deployUrl: string | null;
  published: boolean;
}

export interface VideoArtifact {
  kind: "video";
  title: string | null;
  file: string | null; // rel path under ARTIFACTS_DIR (mp4) OR html composition
  isHtml?: boolean; // true when preview is a live HTML composition (render fallback)
  previewReady: boolean;
  pinned: boolean;
}

export interface ContentLane {
  id: string;
  title: string;
  accent: string;
  topic: string;
  status: string;
  deployTarget?: string;
  cards: ContentCard[];
  artifact: BlogArtifact | VideoArtifact;
}

export interface ContentState {
  updated: number;
  title: string;
  columns: string[];
  lanes: ContentLane[];
}

export async function readState(): Promise<ContentState | null> {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as ContentState;
  } catch {
    return null;
  }
}

export async function writeState(state: ContentState): Promise<void> {
  state.updated = Math.floor(Date.now() / 1000);
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// Resolve an artifact-relative path safely inside ARTIFACTS_DIR (no traversal).
export function resolveArtifact(rel: string): string | null {
  const abs = path.resolve(ARTIFACTS_DIR, rel);
  if (abs !== ARTIFACTS_DIR && !abs.startsWith(ARTIFACTS_DIR + path.sep)) return null;
  return abs;
}
