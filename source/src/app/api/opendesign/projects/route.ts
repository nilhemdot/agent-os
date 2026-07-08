import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy Open Design's project list into the dashboard (the daemon on :7455 sends no
// CORS headers, so the browser can't hit it directly). Powers the Workspace gallery.
const DAEMON = "http://127.0.0.1:7455";
// Open Design renders designs to ~/open-design/.od/projects/<id>/index.html — we flag
// which projects have a rendered file so the gallery can show a live preview vs "building".
const PROJECTS_DIR = path.join(os.homedir(), "open-design", ".od", "projects");
const isRendered = (id: string) => existsSync(path.join(PROJECTS_DIR, id, "index.html"));

interface ODProject {
  id: string; name: string;
  metadata?: { kind?: string; examplePrompt?: boolean };
  createdAt?: number; updatedAt?: number;
}

// Delete a project from Open Design's workspace (daemon removes the DB row + the
// rendered project dir). Called from the Workspace gallery's per-card trash button.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return Response.json({ ok: false, error: "bad id" }, { status: 400 });
  try {
    const r = await fetch(`${DAEMON}/api/projects/${encodeURIComponent(id)}`, { method: "DELETE", signal: AbortSignal.timeout(6000) });
    return Response.json({ ok: r.ok }, { status: r.ok ? 200 : 502, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Open Design isn't running" }, { status: 503 });
  }
}

export async function GET() {
  try {
    const r = await fetch(`${DAEMON}/api/projects`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!r.ok) return Response.json({ projects: [], error: `daemon HTTP ${r.status}` }, { headers: { "cache-control": "no-store" } });
    const j = await r.json();
    const projects = (j.projects ?? []).map((p: ODProject) => ({
      id: p.id,
      name: p.name || "Untitled",
      kind: p.metadata?.kind || "design",
      example: !!p.metadata?.examplePrompt,
      rendered: isRendered(p.id),
      createdAt: p.createdAt ?? 0,
      updatedAt: p.updatedAt ?? p.createdAt ?? 0,
    })).sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt);
    return Response.json({ projects }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ projects: [], error: "Open Design isn't running" }, { headers: { "cache-control": "no-store" } });
  }
}
