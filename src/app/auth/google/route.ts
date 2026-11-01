import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl, googleEnabled } from "@/server/auth";
import { env } from "@/server/env";

export async function GET() {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login", env().APP_URL));
  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("kb_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
