import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { config, hermesHome } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Direct SQLite reads — ~50ms total, vs ~2s+ when this used to shell out to `hermes kanban`.
// Writes still go through the CLI so all the side effects (events, dispatcher signals) fire correctly.
//
// IMPORTANT: kanbanDb imports `node:sqlite`, which only exists on Node 22+. We
// import it DYNAMICALLY inside the handler so that on older Node (or with no
// Hermes set up) the route returns a clean, actionable JSON payload — which the
// Kanban view turns into a "here's how to set this up" card — instead of a hard
// 500 that looks like the dashboard is broken.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const board = url.searchParams.get("board") ?? undefined;
  const slug = board && /^[a-z0-9_-]{1,64}$/.test(board) ? board : undefined;

  const hermesInstalled = !!config.hermes;
  const dbExists = existsSync(path.join(hermesHome(), "kanban.db"));
  const empty = { tasks: [], boards: [], stats: {}, assignees: [] };

  let db: typeof import("@/lib/kanbanDb");
  try {
    db = await import("@/lib/kanbanDb");
  } catch (e) {
    // Almost always: node:sqlite missing because Node < 22.
    return NextResponse.json({
      ok: false, reason: "node-sqlite-missing", error: String(e),
      setup: { hermesInstalled, dbExists, nodeOk: false },
      ...empty,
    });
  }

  try {
    const boards = db.listBoards();
    const activeSlug = slug ?? boards.find((b) => b.current)?.slug ?? "default";
    const tasks = db.listTasks(activeSlug, true);
    const stats = db.statsFor(activeSlug);
    const assignees = db.assigneesFor(activeSlug);
    return NextResponse.json({
      board: activeSlug,
      boards: boards.map(({ slug, name, current }) => ({ slug, name, current })),
      tasks, stats, assignees,
      setup: { hermesInstalled, dbExists, nodeOk: true },
      ok: true,
    });
  } catch (e) {
    // DB couldn't be read — usually Hermes isn't installed / the board hasn't
    // been initialised yet (no ~/.hermes/kanban.db).
    return NextResponse.json({
      ok: false, reason: "db-read-failed", error: String(e),
      setup: { hermesInstalled, dbExists, nodeOk: true },
      ...empty,
    });
  }
}
