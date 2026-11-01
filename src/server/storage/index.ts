import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";

/** S3-compatible object storage (Cloudflare R2 / S3 / local disk for development). */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  private file(key: string) {
    const root = path.resolve(env().STORAGE_DIR);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }
  async get(key: string) {
    try { return await readFile(this.file(key)); } catch { return null; }
  }
  async delete(key: string) { await rm(this.file(key), { force: true }); }
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: env().S3_REGION,
    endpoint: env().S3_ENDPOINT,
    forcePathStyle: !!env().S3_ENDPOINT,
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
}

let storage: Storage | undefined;
export const getStorage = (): Storage => (storage ??= env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage());
export const setStorage = (s: Storage | undefined) => { storage = s; };
