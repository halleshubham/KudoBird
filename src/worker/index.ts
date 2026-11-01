/* Background worker: renders certificates with headless Chromium.  Run: pnpm worker */
import "dotenv/config";
import { Worker } from "bullmq";
import { chromium, type Browser } from "playwright";
import { withPlatform } from "../server/db";
import { env } from "../server/env";
import { sendCertificateEmail, sendDailyDigests, sendRejectionEmail, notifyNewEntry } from "../server/email/notifications";
import { bullConnection, EMAIL_QUEUE, emailQueue, enqueueEmail, enqueueRender, RENDER_QUEUE, type EmailJob, type RenderJob } from "../server/queue";
import { markFailed, renderCertificate } from "./render";

const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? 2);
let browser: Browser | null = null;

/** One long-lived browser shared by all jobs (each job gets its own isolated context). Relaunched if it dies. */
async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--font-render-hinting=none", "--disable-dev-shm-usage"] });
  browser.on("disconnected", () => { browser = null; });
  return browser;
}

env(); // fail fast on bad configuration
const worker = new Worker<RenderJob>(
  RENDER_QUEUE,
  async (job) => {
    const t0 = Date.now();
    try {
      await renderCertificate(await getBrowser(), job.data.certificateId, job.data.force);
      console.log(JSON.stringify({ level: "info", msg: "rendered", certificateId: job.data.certificateId, ms: Date.now() - t0 }));
      // Deliver to the contributor now that the PNG exists (idempotent: no duplicate on regenerate).
      await enqueueEmail({ kind: "certificate", id: job.data.certificateId });
    } catch (e) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      console.error(JSON.stringify({ level: "error", msg: "render failed", certificateId: job.data.certificateId, attempt: job.attemptsMade + 1, error: e instanceof Error ? e.message : String(e) }));
      if (final) await markFailed(job.data.certificateId, e instanceof Error ? e.message : "Render failed");
      throw e;
    }
  },
  { connection: bullConnection(), concurrency: CONCURRENCY },
);

const emailWorker = new Worker<EmailJob>(
  EMAIL_QUEUE,
  async (job) => {
    const d = job.data;
    const result =
      d.kind === "certificate" ? await sendCertificateEmail(d.id, d.force)
      : d.kind === "rejected" ? await sendRejectionEmail(d.id)
      : d.kind === "entry-notify" ? await notifyNewEntry(d.id)
      : await sendDailyDigests();
    console.log(JSON.stringify({ level: "info", msg: "email job", kind: d.kind, id: "id" in d ? d.id : undefined, result }));
  },
  { connection: bullConnection(), concurrency: 5 },
);
// 09:00 IST every day
emailQueue().upsertJobScheduler("daily-digest", { pattern: "30 3 * * *" }, { name: "digest", data: { kind: "digest" } }).catch((e) => console.error("digest schedule failed", e));

// Safety net: re-queue certificates stuck QUEUED/RENDERING (Redis outage at enqueue time, worker crash).
async function sweep() {
  const stale = await withPlatform((tx) =>
    tx.certificate.findMany({
      where: { OR: [
        { renderStatus: "QUEUED", issuedAt: { lt: new Date(Date.now() - 60_000) } },
        // a job that has been RENDERING for minutes means the worker died mid-render
        { renderStatus: "RENDERING", issuedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      ] },
      select: { id: true }, take: 100,
    }),
  );
  for (const c of stale) await enqueueRender(c.id, false);
  // Rendered certificates whose email was never attempted (e.g. Redis was down when the render finished).
  const unsent = await withPlatform((tx) =>
    tx.certificate.findMany({
      where: { renderStatus: "READY", status: "ACTIVE", issuedAt: { gt: new Date(Date.now() - 3 * 86_400_000), lt: new Date(Date.now() - 120_000) }, entry: { emailEnc: { not: null } } },
      select: { id: true }, take: 200,
    }),
  );
  const tried = new Set((await withPlatform((tx) => tx.emailLog.findMany({ where: { certificateId: { in: unsent.map((u) => u.id) }, kind: "CERTIFICATE" }, select: { certificateId: true } }))).map((l) => l.certificateId));
  for (const c of unsent) if (!tried.has(c.id)) await enqueueEmail({ kind: "certificate", id: c.id });
}
const timer = setInterval(() => sweep().catch((e) => console.error("sweep failed", e)), 60_000);

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await emailWorker.close();
  await browser?.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log(`[worker] render worker started (concurrency ${CONCURRENCY})`);
