/* pnpm certificates:backfill
 * Issues certificates for APPROVED entries that have none (e.g. entries created before certificates existed).
 * Safe to re-run: issuing is idempotent per entry. Respects plan limits. */
import "dotenv/config";
import { prisma, withPlatform } from "../src/server/db";
import { issueCertificate } from "../src/server/certificates/issue";

async function main() {
  const entries = await withPlatform((tx) => tx.entry.findMany({ where: { status: "APPROVED", certificate: null }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  let ok = 0, failed = 0;
  for (const e of entries) {
    try { await issueCertificate(e.id); ok++; } catch (err) { failed++; console.error(`entry ${e.id}: ${err instanceof Error ? err.message : err}`); }
  }
  console.log(`Backfill done: ${ok} issued, ${failed} failed, ${entries.length} considered.`);
}
main().finally(async () => { await prisma.$disconnect(); process.exit(0); });
