import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildPreviewHtml } from "@/server/render/preview";
import { requireOrg } from "@/server/session";

const body = z.object({ campaignId: z.string().uuid(), design: z.record(z.unknown()), size: z.enum(["square", "story", "link", "a4"]).optional() });

export async function POST(req: NextRequest) {
  const { ctx } = await requireOrg("campaigns.view");
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    // Fonts missing from the cache are downloaded here once; later renders are offline.
    const html = await buildPreviewHtml(ctx, parsed.data);
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Preview failed" }, { status: 400 });
  }
}
