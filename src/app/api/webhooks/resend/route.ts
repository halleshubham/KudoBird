import { NextRequest, NextResponse } from "next/server";
import { env } from "@/server/env";
import { handleResendEvent, verifyWebhookSignature } from "@/server/email/webhook";

export async function POST(req: NextRequest) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  const body = await req.text(); // raw body: the signature covers the exact bytes
  const id = req.headers.get("svix-id");
  if (!verifyWebhookSignature({ id, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let event;
  try { event = JSON.parse(body); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const result = await handleResendEvent(id!, event);
  return NextResponse.json({ result });
}
