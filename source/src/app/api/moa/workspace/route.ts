import { listCreations } from "@/lib/moaWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything the Mixture-of-Agents panel has made — builds + past runs.
export async function GET() {
  return Response.json(listCreations());
}
