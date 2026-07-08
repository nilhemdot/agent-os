import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^t_[a-z0-9_-]+$/i;
const PROFILE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOARD_RE = /^[a-z0-9_-]{1,64}$/;

interface ActionBody {
  action: "create" | "complete" | "block" | "unblock" | "archive" | "comment" | "assign" | "specify" | "decompose";
  id?: string;
  ids?: string[];
  board?: string;
  // create
  title?: string;
  body?: string;
  assignee?: string;
  triage?: boolean;
  // complete
  result?: string;
  summary?: string;
  // block
  reason?: string;
  // comment
  text?: string;
}

function boardArgs(board?: string): string[] {
  return board && BOARD_RE.test(board) ? ["--board", board] : [];
}

export async function POST(req: Request) {
  const b: ActionBody = await req.json();
  const board = boardArgs(b.board);
  let args: string[] = [];
  let timeoutMs = 20_000;

  switch (b.action) {
    case "create": {
      const title = (b.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
      if (title.length > 500) return NextResponse.json({ error: "title too long" }, { status: 413 });
      args = ["kanban", ...board, "create", title, "--json"];
      if (b.body && b.body.trim()) args.push("--body", b.body.slice(0, 8000));
      if (b.assignee && PROFILE_RE.test(b.assignee)) args.push("--assignee", b.assignee);
      if (b.triage) args.push("--triage");
      break;
    }
    case "complete": {
      const ids = (b.ids?.length ? b.ids : b.id ? [b.id] : []).filter((x) => ID_RE.test(x));
      if (ids.length === 0) return NextResponse.json({ error: "id required" }, { status: 400 });
      args = ["kanban", ...board, "complete", ...ids];
      if (b.result) args.push("--result", b.result.slice(0, 4000));
      if (b.summary) args.push("--summary", b.summary.slice(0, 8000));
      break;
    }
    case "block": {
      if (!b.id || !ID_RE.test(b.id)) return NextResponse.json({ error: "id required" }, { status: 400 });
      const reason = (b.reason ?? "blocked").slice(0, 2000);
      args = ["kanban", ...board, "block", b.id, reason];
      break;
    }
    case "unblock": {
      const ids = (b.ids?.length ? b.ids : b.id ? [b.id] : []).filter((x) => ID_RE.test(x));
      if (ids.length === 0) return NextResponse.json({ error: "id required" }, { status: 400 });
      args = ["kanban", ...board, "unblock", ...ids];
      break;
    }
    case "archive": {
      const ids = (b.ids?.length ? b.ids : b.id ? [b.id] : []).filter((x) => ID_RE.test(x));
      if (ids.length === 0) return NextResponse.json({ error: "id required" }, { status: 400 });
      args = ["kanban", ...board, "archive", ...ids];
      break;
    }
    case "comment": {
      if (!b.id || !ID_RE.test(b.id)) return NextResponse.json({ error: "id required" }, { status: 400 });
      const text = (b.text ?? "").trim();
      if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
      args = ["kanban", ...board, "comment", b.id, text.slice(0, 4000)];
      break;
    }
    case "assign": {
      if (!b.id || !ID_RE.test(b.id)) return NextResponse.json({ error: "id required" }, { status: 400 });
      const profile = (b.assignee ?? "none").trim();
      if (profile !== "none" && !PROFILE_RE.test(profile)) return NextResponse.json({ error: "bad assignee" }, { status: 400 });
      args = ["kanban", ...board, "assign", b.id, profile];
      break;
    }
    case "specify": {
      if (!b.id || !ID_RE.test(b.id)) return NextResponse.json({ error: "id required" }, { status: 400 });
      args = ["kanban", ...board, "specify", b.id, "--json"];
      timeoutMs = 120_000; // calls aux LLM
      break;
    }
    case "decompose": {
      if (!b.id || !ID_RE.test(b.id)) return NextResponse.json({ error: "id required" }, { status: 400 });
      args = ["kanban", ...board, "decompose", b.id, "--json"];
      timeoutMs = 180_000; // calls aux LLM, fans out
      break;
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const out = await run("hermes", args, { timeoutMs });
  // Try to parse JSON output, fall back to plain text
  let parsed: unknown = null;
  try { parsed = JSON.parse(out.stdout); } catch {}
  return NextResponse.json({
    ok: out.ok,
    action: b.action,
    code: out.code,
    durationMs: out.durationMs,
    stdout: parsed ?? out.stdout.slice(0, 4000),
    stderr: out.stderr.slice(0, 2000),
  });
}
