import { NextResponse } from "next/server";
import { memoryStats } from "@/lib/memoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function GET() {
  try {
    const stats = memoryStats();

    return NextResponse.json(
      { ok: true, data: stats } as ApiResponse<typeof stats>,
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) } as ApiResponse<never>,
      { status: 500 }
    );
  }
}
