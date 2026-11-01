import type { Entry } from "@prisma/client";
import { decrypt } from "./crypto";
import { env } from "./env";

const abs = (path: string) => new URL(path, env().APP_URL).toString();

/** Public URLs of a certificate. Images are produced by the worker a few seconds after issuing (see `GET /api/v1/certificates/{id}` for readiness). */
export function certificateUrls(publicId: string) {
  return {
    url: abs(`/c/${publicId}`),
    images: Object.fromEntries((["square", "story", "link", "a4", "pdf"] as const).map((k) => [k, abs(`/c/${publicId}/img/${k}`)])),
  };
}

export const contactOf = (e: Pick<Entry, "mobileEnc" | "emailEnc">) => ({ mobile: decrypt(e.mobileEnc), email: e.emailEnc ? decrypt(e.emailEnc) : null });

export function entryPayload(e: Pick<Entry, "id" | "campaignId" | "name" | "status" | "customData" | "locale" | "createdAt" | "mobileEnc" | "emailEnc">, campaignName: string, includePii: boolean) {
  return {
    entry: { id: e.id, campaignId: e.campaignId, campaignName, name: e.name, status: e.status.toLowerCase(), customFields: e.customData, language: e.locale, createdAt: e.createdAt.toISOString(), ...(includePii ? { contact: contactOf(e) } : {}) },
  };
}

export function certificatePayload(
  c: { publicId: string; number: string; status: string; issuedAt: Date; renderData: unknown; entryId: string; campaignId: string; revokeReason?: string | null },
  campaignName: string, contact?: { mobile: string; email: string | null },
) {
  const d = c.renderData as Record<string, string>;
  return {
    certificate: { id: c.publicId, number: c.number, status: c.status.toLowerCase(), name: d.name, campaignId: c.campaignId, campaignName, entryId: c.entryId, issuedAt: c.issuedAt.toISOString(), ...(c.revokeReason ? { revokeReason: c.revokeReason } : {}), ...certificateUrls(c.publicId), ...(contact ? { contact } : {}) },
  };
}
