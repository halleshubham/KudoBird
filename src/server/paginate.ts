/**
 * Page/size to Prisma `skip`/`take`, with safe bounds. A page of 0, a negative or a non-numeric value becomes page 1
 * (Prisma rejects a negative skip), and the page size can never exceed `max`.
 */
export function paginate(page: unknown, pageSize: number, max = 100): { page: number; pageSize: number; skip: number; take: number } {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const size = Math.min(max, Math.max(1, Math.floor(pageSize) || 1));
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

/** Just the `{ skip, take }` pair, ready to spread into a Prisma `findMany`. */
export const pageArgs = (page: unknown, pageSize: number, max = 100): { skip: number; take: number } => {
  const { skip, take } = paginate(page, pageSize, max);
  return { skip, take };
};
