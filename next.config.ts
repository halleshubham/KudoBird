import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "playwright"],
  poweredByHeader: false,
  // The app itself can only be framed by itself. /embed/* is handled by src/middleware.ts (per-campaign allow-list).
  async headers() {
    return [{
      source: "/((?!embed/).*)",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default config;
