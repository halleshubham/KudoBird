import { NextResponse } from "next/server";
import { getPublicCertificate } from "@/server/certificates/public";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const c = await getPublicCertificate((await params).publicId);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ renderStatus: c.renderStatus, ready: Object.keys(c.outputs).includes("square") && c.renderStatus === "READY", outputs: Object.keys(c.outputs) }, { headers: { "cache-control": "no-store" } });
}
