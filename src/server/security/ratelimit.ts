import Redis from "ioredis";
import { env } from "../env";

let redis: Redis | null | undefined;
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  try {
    redis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false });
    redis.on("error", () => {});
  } catch {
    redis = null;
  }
  return redis;
}

const memory = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window limiter. Redis in production; in-process fallback if Redis is unreachable. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number }> {
  const r = getRedis();
  if (r) {
    try {
      const k = `rl:${key}`;
      const count = await r.incr(k);
      if (count === 1) await r.expire(k, windowSec);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    } catch {
      /* fall through to memory */
    }
  }
  const now = Date.now();
  const e = memory.get(key);
  if (!e || e.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }
  e.count++;
  return { allowed: e.count <= limit, remaining: Math.max(0, limit - e.count) };
}
