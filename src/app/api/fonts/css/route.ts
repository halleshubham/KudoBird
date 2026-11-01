import { NextRequest, NextResponse } from "next/server";
import { fontFaceCss } from "@/server/fonts";
import { requireUser } from "@/server/session";

/** @font-face rules (same-origin file URLs) for the designer's browser-side preview. Missing fonts are downloaded once. */
export async function GET(req: NextRequest) {
  await requireUser();
  const families = req.nextUrl.searchParams.getAll("f").slice(0, 12);
  if (families.some((f) => !f || f.length > 80)) return new NextResponse("Bad request", { status: 400 });
  try {
    return new NextResponse(await fontFaceCss(families, "url"), { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "private, max-age=300" } });
  } catch {
    return new NextResponse("Font unavailable", { status: 404 });
  }
}
