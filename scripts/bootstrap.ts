/* Production start-up step, run by the web container before the server starts. Idempotent.
 *   1. wait for Postgres
 *   2. create / refresh the restricted application role (the one the app connects as) using the owner connection
 *   3. run `prisma migrate deploy`
 *   4. load reference data (Free plan, bundled fonts, starter templates) and promote SUPER_ADMIN_EMAILS
 *   5. REFUSE TO START if the application role could bypass Row Level Security
 * DIRECT_URL = owner connection (migrations). DATABASE_URL = restricted role the app uses (password is applied to the role here). */
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (msg: string): never => { console.error(`[bootstrap] ${msg}`); process.exit(1); };

async function waitFor(client: PrismaClient, label: string) {
  for (let i = 1; i <= 60; i++) {
    try { await client.$queryRaw`SELECT 1`; return; } catch (e) {
      // A wrong password will never fix itself by waiting.
      if (/P1000|[Aa]uthentication failed|password authentication/.test(String(e))) fail(`Authentication to ${label} failed: check the database user and password`);
      if (i === 1) console.log(`[bootstrap] waiting for ${label}…`);
      await sleep(2000);
    }
  }
  fail(`${label} did not become reachable within 2 minutes`);
}

async function main() {
  const ownerUrl = process.env.DIRECT_URL, appUrl = process.env.DATABASE_URL;
  if (!ownerUrl || !appUrl) fail("DIRECT_URL and DATABASE_URL must both be set");
  const app = new URL(appUrl!), owner = new URL(ownerUrl!);
  const appRole = decodeURIComponent(app.username), appPassword = decodeURIComponent(app.password);
  if (!appRole || !appPassword) fail("DATABASE_URL must include the restricted role's user and password");
  if (appRole === decodeURIComponent(owner.username)) fail("DATABASE_URL and DIRECT_URL use the same database user. The app must connect as a separate restricted role, otherwise tenant isolation (Row Level Security) can be bypassed.");

  const admin = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  await waitFor(admin, "the database");
  // Quote the role name and pass the password through format(%L): neither can inject SQL. Existing roles only get their
  // password refreshed (changing attributes would need superuser); new roles are created explicitly restricted.
  const [{ sql, exists }] = await admin.$queryRaw<{ sql: string; exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${appRole}) AS exists,
      format(
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${appRole})
             THEN 'ALTER ROLE %I WITH PASSWORD %L'
             ELSE 'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L' END,
        ${appRole}, ${appPassword}) AS sql`;
  try {
    await admin.$executeRawUnsafe(sql);
    console.log(`[bootstrap] application role "${appRole}" ${exists ? "password refreshed" : "created"}`);
  } catch (e) {
    // e.g. a managed database whose owner cannot manage roles. The credentials are still verified below by connecting as that role.
    if (!exists) throw e;
    console.warn(`[bootstrap] could not refresh the password of "${appRole}" (${(e as Error).message.split("\n").pop()}); continuing`);
  }
  await admin.$disconnect();

  const migrate = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { stdio: "inherit", env: process.env });
  if (migrate.status !== 0) fail("prisma migrate deploy failed");

  // Imported only now so DATABASE_URL (restricted role) is what these modules connect with.
  const { prisma } = await import("../src/server/db");
  const { ensureReferenceData, ensureSuperAdmins } = await import("../src/server/reference-data");
  await waitFor(prisma as unknown as PrismaClient, "the database (application role)");
  await ensureReferenceData();
  console.log("[bootstrap] reference data ready");
  const admins = await ensureSuperAdmins(process.env.SUPER_ADMIN_EMAILS);
  if (admins.length) console.log(`[bootstrap] super admin access ensured for ${admins.length} address(es)`);

  const [r] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (r.rolsuper || r.rolbypassrls) fail("The application database role can bypass Row Level Security. Refusing to start.");
  console.log("[bootstrap] tenant isolation check passed (application role is restricted)");
  await prisma.$disconnect();
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
