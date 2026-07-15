import { NextResponse } from "next/server";
import { listQuarantined } from "@/lib/memoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function GET() {
  try {
    const quarantined = listQuarantined();

    return NextResponse.json(
      { ok: true, data: quarantined } as ApiResponse<typeof quarantined>,
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) } as ApiResponse<never>,
      { status: 500 }
    );
  }
}
