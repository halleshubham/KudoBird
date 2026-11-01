import { NextRequest, NextResponse } from "next/server";
import { exportEntriesCsv } from "@/server/exports";
import { OrgError } from "@/server/orgs";
import { ForbiddenError } from "@/server/permissions";
import { requireOrg } from "@/server/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireOrg("entries.view");
  try {
    const { csv, filename } = await exportEntriesCsv(ctx, (await params).id, { full: req.nextUrl.searchParams.get("full") === "1" });
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof OrgError) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}
