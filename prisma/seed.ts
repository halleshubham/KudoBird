/* Seeds the Free plan and (if SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are set) a super admin.
 * The demo organisation and Marathi campaign are added in later stages. */
import "dotenv/config";
import { hashPassword } from "../src/server/crypto";
import { prisma, withPlatform } from "../src/server/db";
import { ensureDefaultPlan } from "../src/server/entitlements";

async function main() {
  const plan = await withPlatform((tx) => ensureDefaultPlan(tx));
  console.log(`Plan ready: ${plan.name}`);
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    await prisma.user.upsert({
      where: { email },
      create: { email, name: "Platform Admin", passwordHash: await hashPassword(password), isSuperAdmin: true, emailVerifiedAt: new Date() },
      update: {},
    });
    console.log(`Super admin: ${email}`);
  }
}
main().finally(() => prisma.$disconnect());
