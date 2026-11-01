import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailStatus } from "@prisma/client";
import { withPlatform } from "../db";
import { suppressionHash } from "./notifications";

const TOLERANCE_SEC = 300;

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64 key
 * after the `whsec_` prefix; header holds one or more space separated `v1,<sig>`. Rejects stale timestamps (replay).
 */
export function verifyWebhookSignature(headers: { id?: string | null; timestamp?: string | null; signature?: string | null }, body: string, secret: string, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SEC) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Statuses only ever move forward: a late "delivered" must not overwrite "bounced".
const RANK: Record<EmailStatus, number> = { QUEUED: 0, SKIPPED: 0, SUPPRESSED: 0, SENT: 1, DELAYED: 2, DELIVERED: 3, FAILED: 3, BOUNCED: 4, COMPLAINED: 5 };

interface ResendEvent {
  type: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string }; reason?: string };
}

export type WebhookResult = "applied" | "duplicate" | "ignored" | "unknown_email";

export async function handleResendEvent(eventId: string, event: ResendEvent): Promise<WebhookResult> {
  const next: EmailStatus | null =
    ({ "email.sent": "SENT", "email.delivered": "DELIVERED", "email.delivery_delayed": "DELAYED", "email.bounced": "BOUNCED", "email.complained": "COMPLAINED", "email.failed": "FAILED" } as Record<string, EmailStatus>)[event.type] ?? null;
  if (!next || !event.data?.email_id) return "ignored";
  const providerId = event.data.email_id;
  const recipient = (Array.isArray(event.data.to) ? event.data.to[0] : event.data.to)?.toLowerCase();

  return withPlatform(async (tx) => {
    // Svix retries deliveries; the event id makes this idempotent.
    try { await tx.processedWebhook.create({ data: { id: eventId } }); } catch { return "duplicate" as const; }
    const log = await tx.emailLog.findUnique({ where: { providerId } });
    // Complaints and permanent bounces suppress the address platform-wide even if we cannot match the log row.
    const permanent = event.type === "email.complained" || (event.type === "email.bounced" && (event.data?.bounce?.type ?? "Permanent") === "Permanent");
    if (permanent && recipient) {
      await tx.suppression.upsert({ where: { emailHash: suppressionHash(recipient) }, create: { emailHash: suppressionHash(recipient), reason: next === "COMPLAINED" ? "COMPLAINED" : "BOUNCED" }, update: {} });
    }
    if (!log) return "unknown_email" as const;
    if (RANK[next] > RANK[log.status]) await tx.emailLog.update({ where: { id: log.id }, data: { status: next, error: next === "BOUNCED" || next === "FAILED" ? (event.data?.reason ?? event.data?.bounce?.type ?? null) : log.error } });
    return "applied" as const;
  });
}
