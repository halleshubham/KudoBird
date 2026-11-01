import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { AssetKind } from "@prisma/client";
import { actorOf, audit } from "./audit";
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

/** Longest side stored, per kind. A background only ever covers a 1754x1240 page, a logo or signature is printed a few centimetres wide. */
const MAX_SIDE: Record<AssetKind, number> = { BACKGROUND: 2400, LOGO: 1200, SIGNATURE: 1200 };

/**
 * Re-encodes an upload before it is stored: honours the camera's rotation, caps the pixel size, and compresses (photos without transparency
 * become progressive JPEG; anything with transparency stays a palette PNG so logos keep their alpha). SVG is stored as is. Never returns a larger
 * file than it was given unless it had to shrink the pixels.
 */
async function optimizeImage(kind: AssetKind, mime: string, body: Buffer): Promise<{ body: Buffer; mime: string; ext: string }> {
  if (mime === "image/svg+xml") return { body, mime, ext: "svg" };
  try {
    const img = sharp(body, { limitInputPixels: 50_000_000 }).rotate();
    const meta = await sharp(body, { limitInputPixels: 50_000_000 }).metadata();
    const side = MAX_SIDE[kind];
    const resized = Math.max(meta.width ?? 0, meta.height ?? 0) > side;
    const sized = img.resize({ width: side, height: side, fit: "inside", withoutEnlargement: true });
    // Transparent images and flat artwork (logos, signatures) stay PNG: JPEG would smear their edges. Only opaque photos become JPEG.
    const keepPng = !!meta.hasAlpha || (mime === "image/png" && kind !== "BACKGROUND");
    const out = keepPng
      ? { body: await sized.png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer(), mime: "image/png", ext: "png" }
      : { body: await sized.jpeg({ quality: kind === "BACKGROUND" ? 82 : 88, mozjpeg: true, progressive: true }).toBuffer(), mime: "image/jpeg", ext: "jpg" };
    if (!resized && out.body.length >= body.length) return { body, mime, ext: TYPES[mime as keyof typeof TYPES].ext };
    return out;
  } catch {
    throw new OrgError("BAD_FILE", "Could not read this image. Try another PNG or JPG, or a smaller one.");
  }
}

/** SVG is only ever used through <img>, where scripts cannot run, but we also refuse obviously active content. */
const ACTIVE_SVG = /<script|<foreignObject|\son\w+\s*=|javascript:/i;

export async function uploadAsset(ctx: OrgContext, input: { kind: AssetKind; filename: string; mime: string; body: Buffer }) {
  assertCan(ctx.role, input.kind === "SIGNATURE" ? "signatories.manage" : "templates.manage");
  const type = TYPES[input.mime as keyof typeof TYPES];
  if (!type || !type.magic(input.body)) throw new OrgError("BAD_FILE", "Upload a PNG, JPG or SVG image");
  if (input.body.length > MAX_BYTES) throw new OrgError("TOO_LARGE", "Image must be 3 MB or smaller");
  if (input.mime === "image/svg+xml" && ACTIVE_SVG.test(input.body.toString("utf8"))) throw new OrgError("BAD_FILE", "SVG files with scripts are not allowed");
  const img = await optimizeImage(input.kind, input.mime, input.body); // the stored copy is what counts against the storage quota
  const id = randomUUID();
  const storageKey = `${ctx.orgId}/${id}.${img.ext}`;
  const asset = await withTenant(ctx, async (tx) => {
    await assertWithinLimit(tx, ctx.orgId, "storageBytes", img.body.length); // per-org quota
    const a = await tx.asset.create({ data: { id, orgId: ctx.orgId, kind: input.kind, storageKey, mime: img.mime, bytes: img.body.length, filename: input.filename.slice(0, 120) } });
    await recordUsage(tx, ctx.orgId, "storage_bytes", img.body.length);
    await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "asset.uploaded", entity: "Asset", entityId: id, meta: { kind: input.kind } });
    return a;
  });
  await getStorage().put(storageKey, img.body, img.mime);
  return asset;
}

export async function readAsset(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "campaigns.view");
  const a = await withTenant(ctx, (tx) => tx.asset.findFirst({ where: { id, orgId: ctx.orgId } }));
  if (!a) return null;
  const body = await getStorage().get(a.storageKey);
  return body ? { body, mime: a.mime } : null;
}

export async function listAssets(ctx: OrgContext, kind: AssetKind) {
  assertCan(ctx.role, "campaigns.view");
  return withTenant(ctx, (tx) => tx.asset.findMany({ where: { orgId: ctx.orgId, kind }, orderBy: { createdAt: "desc" } }));
}
