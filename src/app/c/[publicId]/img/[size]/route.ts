import { NextRequest, NextResponse } from "next/server";
import { getCertificateOutput } from "@/server/certificates/public";
import type { OutputKey } from "@/server/render/build";
import { getStorage } from "@/server/storage";

const KEYS = ["square", "story", "link", "a4", "pdf"];

/** Public certificate image/PDF. The unguessable id is the capability; nothing here includes contact details. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ publicId: string; size: string }> }) {
  const { publicId, size } = await params;
  if (!KEYS.includes(size)) return new NextResponse("Not found", { status: 404 });
  const out = await getCertificateOutput(publicId, size as OutputKey);
  if (!out) return new NextResponse("Not ready", { status: 404, headers: { "cache-control": "no-store" } });
  if (req.headers.get("if-none-match") === `"${out.hash}"`) return new NextResponse(null, { status: 304 });
  const body = await getStorage().get(out.key);
  if (!body) return new NextResponse("Not found", { status: 404 });
  const ext = size === "pdf" ? "pdf" : "png";
  const headers: Record<string, string> = {
    "content-type": out.mime, etag: `"${out.hash}"`, "x-content-type-options": "nosniff",
    // The hash in ?v= makes each version a distinct URL, so it can be cached forever; without it keep it short.
    "cache-control": req.nextUrl.searchParams.get("v") === out.hash ? "public, max-age=31536000, immutable" : "public, max-age=60, stale-while-revalidate=600",
  };
  if (req.nextUrl.searchParams.get("download")) headers["content-disposition"] = `attachment; filename="certificate-${out.number}-${size}.${ext}"`;
  return new NextResponse(new Uint8Array(body), { headers });
}
