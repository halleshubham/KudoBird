import { NextRequest, NextResponse } from "next/server";
import { loginWithGoogleCode } from "@/server/auth";
import { env } from "@/server/env";
import { setSessionCookie } from "@/server/session";

export async function GET(req: NextRequest) {
  const base = env().APP_URL;
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const fail = (m: string) => NextResponse.redirect(new URL("/login?error=" + encodeURIComponent(m), base));
  if (!code || !state || state !== req.cookies.get("kb_oauth_state")?.value) return fail("Google sign-in failed");
  try {
    const user = await loginWithGoogleCode(code);
    await setSessionCookie(user.id);
    const res = NextResponse.redirect(new URL("/app", base));
    res.cookies.delete("kb_oauth_state");
    return res;
  } catch {
    return fail("Google sign-in failed");
  }
}
