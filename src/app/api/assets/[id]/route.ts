import { NextResponse } from "next/server";
import { readAsset } from "@/server/assets";
import { requireOrg } from "@/server/session";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireOrg();
  const a = await readAsset(ctx, (await params).id);
  if (!a) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(a.body), {
    headers: { "content-type": a.mime, "cache-control": "private, max-age=300", "content-security-policy": "sandbox", "x-content-type-options": "nosniff" },
  });
}
