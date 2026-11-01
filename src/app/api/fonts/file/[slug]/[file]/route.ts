import { NextResponse } from "next/server";
import { readFontFile } from "@/server/fonts";

export async function GET(_: Request, { params }: { params: Promise<{ slug: string; file: string }> }) {
  const { slug, file } = await params;
  const buf = await readFontFile(slug, file);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" } });
}
