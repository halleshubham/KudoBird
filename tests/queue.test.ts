import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { emailQueue, enqueueEmail, enqueueRender, renderQueue } from "@/server/queue";

// Unlike the other suites this uses the REAL queue (Redis). A mock hid a bug where BullMQ rejected job ids containing ":"
// and enqueue failures were swallowed by design. Queues are paused so a developer's running worker cannot steal the jobs.
afterAll(async () => { await renderQueue().resume(); await emailQueue().resume(); await renderQueue().close(); await emailQueue().close(); });

describe("queue (real Redis)", () => {
  it("queues render jobs, normal and forced, without being rejected", async () => {
    const q = renderQueue();
    await q.pause();
    const id = randomUUID();
    await enqueueRender(id);
    await enqueueRender(id, true);
    await enqueueRender(id, true);
    const jobs = (await q.getJobs(["waiting", "delayed", "prioritized"])).filter((j) => j.data.certificateId === id);
    expect(jobs.length).toBe(3);
    expect(jobs.filter((j) => j.data.force).length).toBe(2);
    await Promise.all(jobs.map((j) => j.remove()));
    await q.resume();
  });
  it("queues every email job kind, and a forced resend is not deduplicated away", async () => {
    const q = emailQueue();
    await q.pause();
    const id = randomUUID();
    await enqueueEmail({ kind: "certificate", id });
    await enqueueEmail({ kind: "certificate", id });
    await enqueueEmail({ kind: "certificate", id, force: true });
    await enqueueEmail({ kind: "certificate", id, force: true });
    await enqueueEmail({ kind: "rejected", id });
    await enqueueEmail({ kind: "entry-notify", id });
    const jobs = (await q.getJobs(["waiting", "delayed", "prioritized"])).filter((j) => "id" in j.data && j.data.id === id);
    const kinds = jobs.map((j) => j.data.kind + ("force" in j.data && j.data.force ? ":force" : ""));
    expect(kinds.filter((k) => k === "certificate")).toHaveLength(1); // same id => de-duplicated
    expect(kinds.filter((k) => k === "certificate:force").length).toBeGreaterThanOrEqual(1);
    expect(kinds).toEqual(expect.arrayContaining(["rejected", "entry-notify"]));
    await Promise.all(jobs.map((j) => j.remove()));
    await q.resume();
  });
});
