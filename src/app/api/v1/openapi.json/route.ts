import { NextResponse } from "next/server";
import { openApiDocument } from "@/server/api/openapi";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";
export const GET = () => NextResponse.json(openApiDocument(env().APP_URL), { headers: { "cache-control": "public, max-age=300" } });
