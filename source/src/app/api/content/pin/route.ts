import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/contentStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle (or set) the "pinned" flag on a lane's finished artifact, so its
// preview floats to the pinned area at the top of the board.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const laneId = String(body.lane || "");
  const state = await readState();
  if (!state) return NextResponse.json({ ok: false, error: "no board" }, { status: 404 });
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return NextResponse.json({ ok: false, error: "unknown lane" }, { status: 404 });

  const next = body.pinned === undefined ? !lane.artifact.pinned : body.pinned === true;
  lane.artifact.pinned = next;
  await writeState(state);
  return NextResponse.json({ ok: true, lane: laneId, pinned: next });
}
