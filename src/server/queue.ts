import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export const RENDER_QUEUE = "render";
export const EMAIL_QUEUE = "email";
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
    // (BullMQ forbids ":" in custom job ids.)
    await renderQueue().add("render", { certificateId, force }, { jobId: force ? `${certificateId}-f${randomUUID().slice(0, 8)}` : certificateId });
  } catch (e) {
    console.error("[queue] enqueue failed; sweeper will retry", e instanceof Error ? e.message : e);
  }
}

export type EmailJob =
  | { kind: "certificate"; id: string; force?: boolean } // id = certificate id
  | { kind: "rejected"; id: string } // id = entry id
  | { kind: "entry-notify"; id: string } // id = entry id
  | { kind: "digest" }
  | { kind: "retention" };

let emailQ: Queue<EmailJob> | undefined;
export function emailQueue(): Queue<EmailJob> {
  return (emailQ ??= new Queue<EmailJob>(EMAIL_QUEUE, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: 500, removeOnFail: 1000 },
  }));
}

/** Never throws; contributor emails are re-discovered by the worker's sweeper if the queue was unavailable. */
export async function enqueueEmail(job: EmailJob): Promise<void> {
  try {
    // BullMQ forbids ":" in custom job ids
    const id = job.kind === "digest" || job.kind === "retention" ? undefined : `${job.kind}-${job.id}${"force" in job && job.force ? `-f${randomUUID().slice(0, 8)}` : ""}`;
    await emailQueue().add(job.kind, job, { jobId: id });
  } catch (e) {
    console.error("[queue] email enqueue failed", e instanceof Error ? e.message : e);
  }
}
