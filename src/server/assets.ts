import { randomUUID } from "node:crypto";
import type { AssetKind } from "@prisma/client";
import { audit } from "./audit";
import { withTenant } from "./db";
import { assertWithinLimit, recordUsage } from "./entitlements";
import { OrgError, type OrgContext } from "./orgs";
import { assertCan } from "./permissions";
import { getStorage } from "./storage";

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = {
  "image/png": { ext: "png", magic: (b: Buffer) => b.subarray(0, 4).toString("hex") === "89504e47" },
  "image/jpeg": { ext: "jpg", magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 },
  "image/svg+xml": { ext: "svg", magic: (b: Buffer) => /<svg[\s>]/i.test(b.subarray(0, 2048).toString("utf8")) },
} as const;

/** SVG is only ever used through <img>, where scripts cannot run, but we also refuse obviously active content. */
const ACTIVE_SVG = /<script|<foreignObject|\son\w+\s*=|javascript:/i;

export async function uploadAsset(ctx: OrgContext, input: { kind: AssetKind; filename: string; mime: string; body: Buffer }) {
  assertCan(ctx.role, input.kind === "SIGNATURE" ? "signatories.manage" : "templates.manage");
  const type = TYPES[input.mime as keyof typeof TYPES];
  if (!type || !type.magic(input.body)) throw new OrgError("BAD_FILE", "Upload a PNG, JPG or SVG image");
  if (input.body.length > MAX_BYTES) throw new OrgError("TOO_LARGE", "Image must be 3 MB or smaller");
  if (input.mime === "image/svg+xml" && ACTIVE_SVG.test(input.body.toString("utf8"))) throw new OrgError("BAD_FILE", "SVG files with scripts are not allowed");
  const id = randomUUID();
  const storageKey = `${ctx.orgId}/${id}.${type.ext}`;
  const asset = await withTenant(ctx, async (tx) => {
    await assertWithinLimit(tx, ctx.orgId, "storageBytes", input.body.length); // per-org quota
    const a = await tx.asset.create({ data: { id, orgId: ctx.orgId, kind: input.kind, storageKey, mime: input.mime, bytes: input.body.length, filename: input.filename.slice(0, 120) } });
    await recordUsage(tx, ctx.orgId, "storage_bytes", input.body.length);
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "asset.uploaded", entity: "Asset", entityId: id, meta: { kind: input.kind } });
    return a;
  });
  await getStorage().put(storageKey, input.body, input.mime);
  return asset;
}

export async function readAsset(ctx: OrgContext, id: string) {
  const a = await withTenant(ctx, (tx) => tx.asset.findFirst({ where: { id, orgId: ctx.orgId } }));
  if (!a) return null;
  const body = await getStorage().get(a.storageKey);
  return body ? { body, mime: a.mime } : null;
}

export async function listAssets(ctx: OrgContext, kind: AssetKind) {
  return withTenant(ctx, (tx) => tx.asset.findMany({ where: { orgId: ctx.orgId, kind }, orderBy: { createdAt: "desc" } }));
}
