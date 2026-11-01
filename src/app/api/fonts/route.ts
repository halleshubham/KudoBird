import { NextRequest, NextResponse } from "next/server";
import { listFonts } from "@/server/fonts";
import { requireUser } from "@/server/session";

export async function GET(req: NextRequest) {
  await requireUser();
  const p = req.nextUrl.searchParams;
  return NextResponse.json(await listFonts({ q: p.get("q") ?? undefined, subset: p.get("subset") ?? undefined, limit: 60 }));
}
