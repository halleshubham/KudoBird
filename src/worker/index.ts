/* Background worker: renders certificates with headless Chromium.  Run: pnpm worker */
import "dotenv/config";
import { Worker } from "bullmq";
import { chromium, type Browser } from "playwright";
import { withPlatform } from "../server/db";
import { env } from "../server/env";
import { bullConnection, enqueueRender, RENDER_QUEUE, type RenderJob } from "../server/queue";
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
    } catch (e) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      console.error(JSON.stringify({ level: "error", msg: "render failed", certificateId: job.data.certificateId, attempt: job.attemptsMade + 1, error: e instanceof Error ? e.message : String(e) }));
      if (final) await markFailed(job.data.certificateId, e instanceof Error ? e.message : "Render failed");
      throw e;
    }
  },
  { connection: bullConnection(), concurrency: CONCURRENCY },
);

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
}
const timer = setInterval(() => sweep().catch((e) => console.error("sweep failed", e)), 60_000);

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await browser?.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log(`[worker] render worker started (concurrency ${CONCURRENCY})`);
