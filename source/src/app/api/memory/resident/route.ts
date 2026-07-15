import { NextResponse } from "next/server";
import { getResidentContext } from "@/lib/memoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function GET() {
  try {
    // ponytail: fail closed — only trusted human + promoted records, never quarantined
    const context = getResidentContext();

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
