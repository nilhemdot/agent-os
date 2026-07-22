import { NextResponse } from "next/server";
import { searchMemory, type Memory } from "@/lib/memoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

type SearchResult = { readonly trusted: Memory[]; readonly quarantined: Memory[] };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const includeQuarantined = url.searchParams.get("includeQuarantined") === "true";

    if (!q.trim()) {
      return NextResponse.json(
        { ok: true, data: { trusted: [], quarantined: [] } } as ApiResponse<SearchResult>,
        { status: 200 }
      );
    }

    const result = searchMemory(q, { includeQuarantined });
    return NextResponse.json(
      { ok: true, data: result } as ApiResponse<SearchResult>,
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) } as ApiResponse<never>,
      { status: 500 }
    );
  }
}
