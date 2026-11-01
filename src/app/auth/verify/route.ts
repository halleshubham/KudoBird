import { NextRequest, NextResponse } from "next/server";
import { consumeAuthToken } from "@/server/auth";
import { env } from "@/server/env";
import { setSessionCookie } from "@/server/session";

export async function GET(req: NextRequest) {
  const base = env().APP_URL;
  try {
    const user = await consumeAuthToken(req.nextUrl.searchParams.get("token") ?? "", "VERIFY_EMAIL");
    await setSessionCookie(user.id);
    return NextResponse.redirect(new URL("/app", base));
  } catch {
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("This link is invalid or has expired"), base));
  }
}
