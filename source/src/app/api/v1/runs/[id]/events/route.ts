import { getRun, listRunEvents } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return new Response("not found", { status: 404 });
  let after = Number(req.headers.get("last-event-id") || new URL(req.url).searchParams.get("after") || 0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        for (const event of listRunEvents(id, after)) {
          after = event.seq;
          controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        }
        const status = getRun(id)?.status;
        if (["completed", "failed", "worker_lost"].includes(status || "")) { if (timer) clearInterval(timer); controller.close(); return true; }
        return false;
      };
      if (!send()) timer = setInterval(send, 500);
    },
    cancel() { if (timer) clearInterval(timer); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
