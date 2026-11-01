import { NextRequest, NextResponse } from "next/server";
import { AssetKind } from "@prisma/client";
import { EntitlementError } from "@/server/entitlements";
import { OrgError } from "@/server/orgs";
import { ForbiddenError } from "@/server/permissions";
import { uploadAsset } from "@/server/assets";
import { requireOrg } from "@/server/session";

export async function POST(req: NextRequest) {
  const { ctx } = await requireOrg();
  const form = await req.formData();
  const file = form.get("file");
  const kind = AssetKind[String(form.get("kind")) as keyof typeof AssetKind];
  if (!(file instanceof File) || !kind) return NextResponse.json({ error: "Missing file or kind" }, { status: 400 });
  try {
    const a = await uploadAsset(ctx, { kind, filename: file.name, mime: file.type, body: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ id: a.id });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    if (e instanceof OrgError || e instanceof EntitlementError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
