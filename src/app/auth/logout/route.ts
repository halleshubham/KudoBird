import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { clearSessionCookie } from "@/server/session";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", env().APP_URL), 303);
}
