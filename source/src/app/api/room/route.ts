import { roomAgents, roomReply, roomContext, executeRoomActions, mentionedIds, getAgent, type RoomTurn } from "@/lib/agentRoom";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET → the roster (so the UI can render the agent chips)
export async function GET() {
  const roster = roomAgents().map(({ id, name, color, model, provider }) => ({ id, name, color, model, provider }));
  return Response.json({ agents: roster });
}

// POST { message, history:[{speaker,text}], agents:[ids] }
// Streams NDJSON: {t:"typing",id} … {t:"msg",id,name,color,text} … {t:"done"}
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  if (!message) return new Response("empty message", { status: 400 });

  const present: string[] = Array.isArray(body.agents) && body.agents.length
    ? body.agents.filter((x: unknown) => typeof x === "string")
    : roomAgents().map((a) => a.id);

  // @mentions narrow the round to just those agents (if any are present)
  const mentioned = mentionedIds(message).filter((id) => present.includes(id));
  const replierIds = (mentioned.length ? mentioned : present);
  const repliers = roomAgents().filter((a) => replierIds.includes(a.id));

  const history: RoomTurn[] = Array.isArray(body.history)
    ? body.history.filter((h: { speaker?: unknown; text?: unknown }) => h && typeof h.speaker === "string" && typeof h.text === "string")
        .map((h: { speaker: string; text: string }) => ({ speaker: h.speaker, text: h.text.slice(0, 2000) }))
    : [];
  const transcript: RoomTurn[] = [...history, { speaker: config.userName, text: message }];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch {} };
      // Pull the user's own vault context once for the whole round + show sources.
      let ctx: { text: string; sources: { kind: string; title: string }[] } = { text: "", sources: [] };
      try { ctx = await roomContext(message); } catch {}
      if (ctx.sources.length) send({ t: "context", sources: ctx.sources });

      for (const agent of repliers) {
        if (req.signal.aborted) break;
        send({ t: "typing", id: agent.id, name: agent.name, color: agent.color });
        let raw = "";
        try { raw = await roomReply(agent, transcript, ctx.text, req.signal); }
        catch (e) { if (req.signal.aborted) break; raw = `(${agent.name} couldn't reply — ${String(e).slice(0, 80)})`; }
        if (!raw) raw = "…";
        // run any NOTE:: / PIPELINE:: actions the agent emitted
        const { clean, actions } = await executeRoomActions(raw);
        transcript.push({ speaker: agent.name, text: clean });
        send({ t: "msg", id: agent.id, name: agent.name, color: agent.color, text: clean });
        for (const a of actions) send({ t: "action", id: agent.id, name: agent.name, color: agent.color, ...a });
      }
      send({ t: "done" });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

void getAgent;
