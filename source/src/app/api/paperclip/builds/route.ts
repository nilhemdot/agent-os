import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gallery feed: every Paperclip issue that shipped a build (has a live-build
// link + an image attachment). Auto-tracks history — as agents attach a build
// and drop a /builds/ link in the description, it shows up here.

const PAPERCLIP = process.env.PAPERCLIP_API || "http://localhost:3100/api";
const COMPANY = process.env.PAPERCLIP_COMPANY || ""; // your OWN company id (set PAPERCLIP_COMPANY) — never ship one
const BUILD_RE = /(https?:\/\/[^\s)]+\/builds\/[A-Za-z0-9_.-]+\.html)/i;

async function jget<T>(path: string, fb: T): Promise<T> {
  try {
    const r = await fetch(`${PAPERCLIP}${path}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!r.ok) return fb;
    return (await r.json()) as T;
  } catch {
    return fb;
  }
}

type Agent = { id: string; name?: string; icon?: string };
type Issue = { id: string; identifier?: string; title?: string; description?: string; status?: string; assigneeAgentId?: string | null; projectId?: string; createdAt?: string; updatedAt?: string };
type Att = { id: string; contentType?: string; mimeType?: string };
type Project = { id: string; name?: string };

export async function GET() {
  const [agents, issues, projects] = await Promise.all([
    jget<Agent[]>(`/companies/${COMPANY}/agents`, []),
    jget<Issue[]>(`/companies/${COMPANY}/issues`, []),
    jget<Project[]>(`/companies/${COMPANY}/projects`, []),
  ]);

  const agentOf = (id?: string | null) => agents.find((a) => a.id === id);
  const projOf = (id?: string) => projects.find((p) => p.id === id)?.name || "";

  const candidates = (issues || []).filter((i) => typeof i.description === "string" && BUILD_RE.test(i.description));

  const builds = await Promise.all(
    candidates.map(async (i) => {
      const m = (i.description || "").match(BUILD_RE);
      const liveUrl = m ? m[1] : null;
      const atts = await jget<Att[]>(`/issues/${i.id}/attachments`, []);
      const img = (atts || []).find((a) => String(a.contentType || a.mimeType || "").startsWith("image/"));
      const ag = agentOf(i.assigneeAgentId);
      return {
        issueId: i.id,
        identifier: i.identifier || "",
        title: i.title || "Untitled build",
        status: i.status || "",
        agent: ag?.name || null,
        agentIcon: ag?.icon || "",
        project: projOf(i.projectId),
        createdAt: i.createdAt || i.updatedAt || "",
        liveUrl,
        previewUrl: img ? `/api/paperclip/attachment/${img.id}` : null,
      };
    })
  );

  builds.sort((a, b) => Date.parse(b.createdAt || "0") - Date.parse(a.createdAt || "0"));
  return NextResponse.json({ count: builds.length, builds });
}
