import { NextRequest, NextResponse } from "next/server";
import { getResidentContext } from "@/lib/memoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function GET(req: NextRequest) {
  try {
    // ponytail: fail closed — only trusted human + promoted records, never quarantined
    const searchParams = req.nextUrl.searchParams;
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    let limit: number | undefined;
    let offset: number | undefined;

    // Validate limit
    if (limitParam !== null) {
      if (!/^\d+$/.test(limitParam)) {
        return NextResponse.json(
          { ok: false, error: "limit must be a non-negative integer" } as ApiResponse<never>,
          { status: 400 }
        );
      }
      limit = Math.min(Number(limitParam), 1000);
    }

    // Validate offset
    if (offsetParam !== null) {
      if (!/^\d+$/.test(offsetParam)) {
        return NextResponse.json(
          { ok: false, error: "offset must be a non-negative integer" } as ApiResponse<never>,
          { status: 400 }
        );
      }
      offset = Number(offsetParam);
    }

    const context = getResidentContext({ limit, offset });

    return NextResponse.json(
      { ok: true, data: context } as ApiResponse<typeof context>,
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) } as ApiResponse<never>,
      { status: 500 }
    );
  }
}
