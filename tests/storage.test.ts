import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage, TieredStorage, type Storage } from "../src/server/storage";

const memory = (): Storage & { m: Map<string, Buffer> } => {
  const m = new Map<string, Buffer>();
  return { m, put: async (k, b) => { m.set(k, b); }, get: async (k) => m.get(k) ?? null, delete: async (k) => { m.delete(k); } };
};

describe("tiered storage (R2 first, disk fallback)", () => {
  let dir: string;
  const prev = process.env.STORAGE_DIR;
  beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "kb-storage-")); process.env.STORAGE_DIR = dir; });
  afterAll(async () => { process.env.STORAGE_DIR = prev; await rm(dir, { recursive: true, force: true }); });

  it("writes go to R2 only; reads fall back to disk for files that predate R2; deletes clear both", async () => {
    const r2 = memory();
    const disk = new LocalStorage();
    const s = new TieredStorage(r2, disk);
    await disk.put("org/old.png", Buffer.from("old"), "image/png");
    await s.put("org/new.png", Buffer.from("new"), "image/png");
    expect(r2.m.has("org/new.png")).toBe(true);
    expect(await disk.get("org/new.png")).toBeNull();
    expect((await s.get("org/old.png"))?.toString()).toBe("old");
    expect((await s.get("org/new.png"))?.toString()).toBe("new");
    expect(await s.get("org/missing.png")).toBeNull();
    await s.delete("org/old.png");
    expect(await s.get("org/old.png")).toBeNull();
  });
});
