import { NextRequest, NextResponse } from "next/server";
import { consumeAuthToken } from "@/server/auth";
import { env } from "@/server/env";
import { setSessionCookie } from "@/server/session";

export async function GET(req: NextRequest) {
  const base = env().APP_URL;
  const next = req.nextUrl.searchParams.get("next");
  try {
    const user = await consumeAuthToken(req.nextUrl.searchParams.get("token") ?? "", "MAGIC_LINK");
    await setSessionCookie(user.id);
    return NextResponse.redirect(new URL(next && next.startsWith("/") && !next.startsWith("//") ? next : "/app", base));
  } catch {
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("This link is invalid or has expired"), base));
  }
}
