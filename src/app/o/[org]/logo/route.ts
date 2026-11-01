import { NextResponse } from "next/server";
import { getPublicOrgLogo } from "@/server/public-org";

export async function GET(_: Request, { params }: { params: Promise<{ org: string }> }) {
  const l = await getPublicOrgLogo((await params).org);
  if (!l) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(l.body), { headers: { "content-type": l.mime, "cache-control": "public, max-age=300", "content-security-policy": "sandbox", "x-content-type-options": "nosniff" } });
}
