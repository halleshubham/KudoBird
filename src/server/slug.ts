import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { OrgError } from "./errors";

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "org";
}

/** True only for a unique-constraint violation on a `slug` column (not, say, a certificate prefix). */
const isSlugConflict = (e: unknown) => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta?.target as string[] | string | undefined) ?? [];
  return (Array.isArray(target) ? target : [target]).some((t) => String(t).includes("slug"));
};

/**
 * Runs `create(slug)` with `base`, and if that address is taken retries with a short random suffix.
 * Any other failure, including other unique violations, is rethrown untouched.
 */
export async function withUniqueSlug<T>(base: string, noun: string, create: (slug: string) => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await create(i === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`);
    } catch (e) {
      if (!isSlugConflict(e)) throw e;
    }
  }
  throw new OrgError("SLUG_TAKEN", `Could not allocate a unique ${noun} address`);
}
