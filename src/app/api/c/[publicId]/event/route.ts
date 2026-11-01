import { NextRequest, NextResponse } from "next/server";
import { recordCertificateEvent } from "@/server/certificates/events";

export async function POST(req: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const body = await req.json().catch(() => ({}));
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const result = await recordCertificateEvent(publicId, { type: String(body.type), platform: typeof body.platform === "string" ? body.platform : undefined }, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  const status = result === "not_found" ? 404 : result === "invalid" ? 400 : result === "rate_limited" ? 429 : 204;
  return new NextResponse(null, { status });
}
