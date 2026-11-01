import { NextRequest, NextResponse } from "next/server";

/**
 * Embedded forms may be framed ONLY by the websites the org listed for that campaign. Everything else in the app sets
 * `frame-ancestors 'self'` through next.config.ts. Failing closed: if the policy lookup fails, nobody may frame the form.
 */
export async function middleware(req: NextRequest) {
  const m = req.nextUrl.pathname.match(/^\/embed\/o\/([^/]+)\/([^/]+)/);
  let ancestors = "'none'";
  if (m) {
    try {
      const r = await fetch(new URL(`/api/embed-policy?org=${encodeURIComponent(m[1])}&campaign=${encodeURIComponent(m[2])}`, req.url), { next: { revalidate: 30 } });
      const { origins } = (await r.json()) as { origins?: string[] };
      if (r.ok && origins?.length) ancestors = origins.join(" ");
    } catch { /* keep 'none' */ }
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = { matcher: ["/embed/:path*"] };
