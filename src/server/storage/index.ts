import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";

/** Object storage: Cloudflare R2 (any S3-compatible bucket) when configured, local disk otherwise. */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class LocalStorage implements Storage {
  private file(key: string) {
    const root = path.resolve(env().STORAGE_DIR);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, body: Buffer, _contentType?: string) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }
  async get(key: string) {
    try { return await readFile(this.file(key)); } catch { return null; }
  }
  async delete(key: string) { await rm(this.file(key), { force: true }); }
}

const s3Endpoint = () => env().S3_ENDPOINT ?? (env().R2_ACCOUNT_ID ? `https://${env().R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
export const isObjectStorageConfigured = () => !!(env().S3_BUCKET && env().S3_ACCESS_KEY_ID && env().S3_SECRET_ACCESS_KEY);

export class S3Storage implements Storage {
  private client = new S3Client({
    region: env().S3_REGION,
    endpoint: s3Endpoint(),
    forcePathStyle: !!s3Endpoint(),
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID!, secretAccessKey: env().S3_SECRET_ACCESS_KEY! },
  });
  private bucket = env().S3_BUCKET!;
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch { return null; }
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async exists(key: string) {
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; } catch { return false; }
  }
}

/**
 * R2 first, local disk as the fallback. New files go to R2. Reads that miss R2 (files uploaded before R2 was switched on, or an R2 hiccup)
 * are served from disk, so enabling R2 never breaks existing certificates; `pnpm storage:migrate` copies the old files across.
 */
export class TieredStorage implements Storage {
  constructor(private primary: Storage, private fallback: Storage) {}
  put(key: string, body: Buffer, contentType: string) { return this.primary.put(key, body, contentType); }
  async get(key: string) { return (await this.primary.get(key)) ?? this.fallback.get(key); }
  async delete(key: string) { await Promise.all([this.primary.delete(key), this.fallback.delete(key)]); }
}

let storage: Storage | undefined;
export const getStorage = (): Storage => (storage ??= createStorage());

function createStorage(): Storage {
  const driver = env().STORAGE_DRIVER;
  if (driver === "s3") return new S3Storage();
  if (driver === "auto" && isObjectStorageConfigured()) return new TieredStorage(new S3Storage(), new LocalStorage());
  return new LocalStorage();
}
export const setStorage = (s: Storage | undefined) => { storage = s; };
