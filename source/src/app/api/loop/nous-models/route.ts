import { nousToken, nousModels } from "@/lib/loopEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → { loggedIn, models[] }. Reads the Nous Portal OAuth token from ~/.hermes/auth.json
// (written by `hermes portal`) and lists the free Portal models for the Loop builder picker.
export async function GET() {
  const token = nousToken();
  if (!token) return Response.json({ loggedIn: false, models: [] });
  try {
    const models = await nousModels(token);
    return Response.json({ loggedIn: true, models });
  } catch (e) {
    return Response.json({ loggedIn: true, models: [], error: String(e).slice(0, 200) });
  }
}
