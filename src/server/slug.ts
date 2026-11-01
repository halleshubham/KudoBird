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

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Runs `create(slug)` with `base`; if that address is taken, retries with a short random suffix.
 *
 * A unique violation is only treated as "address taken" after asking the database (`isTaken`). Prisma does not reliably say
 * WHICH constraint failed (`meta.target` is null with the pg driver), so guessing from the error would either miss real slug
 * clashes or hide unrelated violations. Any other failure is rethrown untouched.
 */
export async function withUniqueSlug<T>(base: string, noun: string, create: (slug: string) => Promise<T>, isTaken: (slug: string) => Promise<boolean>, attempts = 5): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const slug = i === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    try {
      return await create(slug);
    } catch (e) {
      if (!isUniqueViolation(e) || !(await isTaken(slug))) throw e;
    }
  }
  throw new OrgError("SLUG_TAKEN", `Could not allocate a unique ${noun} address`);
}
