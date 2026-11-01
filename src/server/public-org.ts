import { withPlatform } from "./db";
import { getStorage } from "./storage";

/** Public organisation page data: branding and ACTIVE campaigns only. */
export async function getPublicOrg(slug: string) {
  const org = await withPlatform((tx) => tx.organization.findFirst({ where: { slug, status: "ACTIVE", deletedAt: null } }));
  if (!org) return null;
  const campaigns = await withPlatform((tx) => tx.campaign.findMany({ where: { orgId: org.id, status: "ACTIVE", archivedAt: null }, orderBy: { createdAt: "desc" }, select: { name: true, slug: true, description: true } }));
  return { name: org.name, slug: org.slug, primaryColor: org.primaryColor, hasLogo: !!org.logoAssetId, campaigns };
}

export async function getPublicOrgLogo(slug: string) {
  const org = await withPlatform((tx) => tx.organization.findFirst({ where: { slug, status: "ACTIVE", deletedAt: null } }));
  if (!org?.logoAssetId) return null;
  const a = await withPlatform((tx) => tx.asset.findFirst({ where: { id: org.logoAssetId!, orgId: org.id, kind: "LOGO" } }));
  const body = a ? await getStorage().get(a.storageKey) : null;
  return a && body ? { body, mime: a.mime } : null;
}
