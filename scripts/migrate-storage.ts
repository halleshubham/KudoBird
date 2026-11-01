/* pnpm storage:migrate [--delete-local]
 * Copies every file under STORAGE_DIR to Cloudflare R2 (the S3_* / R2_ACCOUNT_ID variables). Safe to re-run: files already in R2 are skipped.
 * Until you pass --delete-local the originals stay on disk as the fallback. */
import "dotenv/config";
import { readdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/server/env";
import { isObjectStorageConfigured, S3Storage } from "../src/server/storage";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", pdf: "application/pdf" };

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main() {
  if (!isObjectStorageConfigured()) throw new Error("R2 is not configured: set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and R2_ACCOUNT_ID for Cloudflare R2).");
  const root = path.resolve(env().STORAGE_DIR);
  const remote = new S3Storage();
  let copied = 0, skipped = 0;
  for await (const file of walk(root)) {
    const key = path.relative(root, file).split(path.sep).join("/");
    if (await remote.exists(key)) skipped++;
    else { await remote.put(key, await readFile(file), MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream"); copied++; }
    if (process.argv.includes("--delete-local")) await rm(file);
  }
  console.log(`Storage migration done: ${copied} copied, ${skipped} already in R2${process.argv.includes("--delete-local") ? ", local copies removed" : ""}.`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
