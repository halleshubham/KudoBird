/* Usage: pnpm create-super-admin <email> <password> [name]
 * Creates (or promotes) a platform super admin. 2FA enrolment is forced at first sign-in. */
import "dotenv/config";
import { hashPassword } from "../src/server/crypto";
import { prisma } from "../src/server/db";

async function main() {
  const [emailArg, password, name] = process.argv.slice(2);
  if (!emailArg || !password || password.length < 12) {
    console.error("Usage: pnpm create-super-admin <email> <password (12+ chars)> [name]");
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, isSuperAdmin: true, emailVerifiedAt: new Date() },
    update: { passwordHash, isSuperAdmin: true, emailVerifiedAt: new Date() },
  });
  console.log(`Super admin ready: ${user.email}. Sign in at /login; you will be asked to set up 2FA.`);
}

main().finally(() => prisma.$disconnect());
