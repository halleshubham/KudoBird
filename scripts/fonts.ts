/* pnpm fonts:sync   -> import the Google Fonts catalogue into the database
 * pnpm fonts:bundle -> download the bundled Devanagari fonts into assets/fonts (committed to git) */
import "dotenv/config";
import path from "node:path";
import { prisma } from "../src/server/db";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "sync") {
    const { syncFontCatalogue } = await import("../src/server/fonts");
    console.log(`Synced ${await syncFontCatalogue()} fonts`);
  } else if (cmd === "bundle") {
    process.env.FONT_CACHE_DIR = path.join(process.cwd(), "assets", "fonts");
    const { ensureFont } = await import("../src/server/fonts");
    const { BUNDLED_FONTS } = await import("../src/server/fonts/curated");
    for (const f of BUNDLED_FONTS) {
      const { manifest } = await ensureFont(f, [400, 700]);
      console.log(`${f}: ${manifest.faces.length} files`);
    }
  } else {
    console.error("Usage: tsx scripts/fonts.ts sync|bundle");
    process.exit(1);
  }
}
main().finally(() => prisma.$disconnect());
