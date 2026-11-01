import { z } from "zod";
import { prisma, type Tx } from "./db";

/** Global, super-admin-managed settings. One JSON document under the key "general". */
export const platformSettingsSchema = z.object({
  signupsOpen: z.boolean().default(true),
  /** Plan key assigned to organisations created from now on. */
  defaultPlanKey: z.string().min(1).max(40).default("free"),
  /** Shown as a banner to every signed-in user (maintenance notices etc.). Empty = none. */
  announcement: z.string().max(300).default(""),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

const KEY = "general";

export async function getPlatformSettings(db: Pick<typeof prisma, "platformSetting"> | Tx = prisma): Promise<PlatformSettings> {
  const row = await db.platformSetting.findUnique({ where: { key: KEY } });
  const parsed = platformSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : platformSettingsSchema.parse({});
}

export async function savePlatformSettings(value: PlatformSettings, db: Pick<typeof prisma, "platformSetting"> | Tx = prisma): Promise<PlatformSettings> {
  const v = platformSettingsSchema.parse(value);
  await db.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: v }, update: { value: v } });
  return v;
}

export class SignupsClosedError extends Error {
  constructor() { super("New sign-ups are temporarily closed."); }
}

/** Existing users can always sign in; only creating NEW accounts is blocked. */
export async function assertSignupsOpen(): Promise<void> {
  if (!(await getPlatformSettings()).signupsOpen) throw new SignupsClosedError();
}
