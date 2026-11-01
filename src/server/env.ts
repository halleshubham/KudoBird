import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default("KudoBird <no-reply@localhost>"),
  SENTRY_DSN: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /** Public site key. Read at request time (NOT NEXT_PUBLIC_*, which Next would freeze into a prebuilt image). */
  TURNSTILE_SITE_KEY: z.string().optional(),
  /** auto (default): Cloudflare R2 / S3 when its variables are set, local disk otherwise. local / s3 force one backend. */
  STORAGE_DRIVER: z.enum(["auto", "local", "s3"]).default("auto"),
  STORAGE_DIR: z.string().default("./storage/files"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(),
  /** Cloudflare R2: with this set, the endpoint is https://<account>.r2.cloudflarestorage.com unless S3_ENDPOINT overrides it. */
  R2_ACCOUNT_ID: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

const refined = schema.superRefine((e, ctx) => {
  if (e.STORAGE_DRIVER === "s3" && !(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY)) {
    ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3" });
  }
});

let cached: Env | undefined;

/** Validates process.env once; throws a readable error listing every problem. */
export function env(): Env {
  if (cached) return cached;
  const parsed = refined.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
