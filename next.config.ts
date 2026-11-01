import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "playwright"],
  poweredByHeader: false,
};
export default config;
