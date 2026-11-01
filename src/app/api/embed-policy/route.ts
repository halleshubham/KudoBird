import { NextRequest, NextResponse } from "next/server";
import { getPublicCampaign } from "@/server/campaigns/public";

/** Which sites may frame a campaign's embedded form. Read by the middleware to set `frame-ancestors`. Contains no secrets. */
export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") ?? "", campaign = req.nextUrl.searchParams.get("campaign") ?? "";
  const c = org && campaign ? await getPublicCampaign(org, campaign) : null;
  return NextResponse.json({ origins: c?.status === "ACTIVE" ? c.settings.embedOrigins : [] }, { headers: { "cache-control": "public, max-age=30" } });
}
