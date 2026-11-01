import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export const RENDER_QUEUE = "render";
export interface RenderJob { certificateId: string; force?: boolean }

let queue: Queue<RenderJob> | undefined;
let conn: IORedis | undefined;

/** Connection for BullMQ (it requires maxRetriesPerRequest: null). */
export function bullConnection(): IORedis {
  return (conn ??= new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null }));
}

export function renderQueue(): Queue<RenderJob> {
  return (queue ??= new Queue<RenderJob>(RENDER_QUEUE, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 200, removeOnFail: 500 },
  }));
}

/**
 * Queues a render. Never throws: if Redis is down the certificate stays QUEUED and the
 * worker's sweeper picks it up, so issuing a certificate never fails because of the queue.
 */
export async function enqueueRender(certificateId: string, force = false): Promise<void> {
  try {
    // A unique job id per request when forcing, so a regenerate is not swallowed by a finished job.
    await renderQueue().add("render", { certificateId, force }, { jobId: force ? `${certificateId}:${Date.now()}` : certificateId });
  } catch (e) {
    console.error("[queue] enqueue failed; sweeper will retry", e instanceof Error ? e.message : e);
  }
}
