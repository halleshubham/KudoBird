# KudoBird

Multi-tenant platform for issuing contribution / participation certificates for any organisation, campaign or event.
Free for now; plans, limits and feature flags are already wired through one entitlement service.

> Status: **Stage 4 of 7** (sharing and Resend emails). Stages 5 to 7 are still to come. See the roadmap at the bottom.

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL + Prisma · Redis/BullMQ (stage 3) · Playwright (stage 3) · Resend + React Email · Tailwind 3 · pnpm.

## Local setup

Requirements: Node 22, pnpm 10, PostgreSQL 16, Redis 7 (Docker Compose provides both).

```bash
pnpm install
cp .env.example .env          # edit AUTH_SECRET (32+ random chars)
docker compose up -d postgres redis
pnpm exec prisma migrate deploy
pnpm db:seed                  # Free plan, starter templates, super admin, demo org + Marathi campaign
pnpm fonts:sync               # optional: import the full Google Fonts catalogue (needs internet once)
pnpm dev                      # http://localhost:3000
pnpm worker                   # in a second terminal: renders certificates (needs Redis + Chromium)
```

Without Docker, create the roles yourself (see `docker/init-roles.sql`): `kudobird` (owner, used for migrations) and
`kudobird_app` (restricted; **must not** be superuser or `BYPASSRLS`).

Without `RESEND_API_KEY`, emails are printed to the server console (verification, magic links, invites), so you can develop with no email account.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Connection as the **restricted** app role (RLS enforced) |
| `DIRECT_URL` | Connection as the table owner, used only by `prisma migrate` |
| `REDIS_URL` | Queue/cache |
| `APP_URL` | Public base URL, used in emailed links |
| `AUTH_SECRET` | 32+ chars. Derives token hashing and PII encryption keys. **Rotating it invalidates sessions and encrypted data; back it up.** |
| `GOOGLE_CLIENT_ID/SECRET` | Optional Google sign-in (redirect URI: `$APP_URL/auth/google/callback`) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | Email delivery and webhook verification |
| `SENTRY_DSN` | Optional error monitoring |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile bot check on the public form. Unset = bot check is skipped (dev). **Set both in production.** |
| `STORAGE_DRIVER` | `local` (default, `STORAGE_DIR`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; works with Cloudflare R2) |
| `FONT_CACHE_DIR` | Where downloaded Google fonts are cached (default `./storage/fonts`) |

The environment is validated at startup; the app refuses to run with a clear message if something is missing or invalid.

## Demo data

`pnpm db:seed` creates a working demo (idempotent):

| What | Value |
|---|---|
| Demo org owner | `demo@kudobird.local` / `demo-password-123` |
| Public form (Marathi, Noto Serif Devanagari) | `/o/demo/baliraja-diwali` |
| Super admin | `admin@kudobird.local` / `admin-password-123` (override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; 2FA is forced at first sign-in) |

Change these before exposing an instance to the internet.

## First super admin

```bash
pnpm create-super-admin you@example.com 'a-long-password' 'Your Name'
```

Sign in at `/login`; two-factor authentication (TOTP) enrolment is forced for super admins.

## Creating an organisation

Sign up at `/signup`, then name your workspace. You become its **Owner** and the org is placed on the Free plan.
Invite teammates at *Members*; one person can belong to several orgs and switch between them in the header.

## How tenant isolation works

Every tenant table has an `orgId`. PostgreSQL **Row Level Security** policies (`prisma/migrations/*_rls`) restrict each
query to the organisation set in the transaction (`app.org_id`). The app connects as a non-superuser role without
`BYPASSRLS`, and all tenant access goes through `withTenant()` (`src/server/db.ts`). A forgotten `where` clause therefore
cannot leak data. `withPlatform()` is the single audited bypass for super admin, workers and public pages.
`tests/tenant-isolation.test.ts` proves an org cannot read, insert, update or delete another org's rows.

## Campaigns, form and designer

Create a campaign (*Campaigns -> New*), set it **Active**, and share `/o/{org}/{campaign}`. Under the campaign:

- **Form**: Full name, mobile (default +91, 10 digits, country configurable) and optional email are built in. Add custom fields (text, number, date, select, textarea) with required/validation, Hindi/Marathi labels, and a flag for use on the certificate. Their `key` becomes a `{{key}}` placeholder.
- **Overview**: approval mode, duplicate policy (return existing / block / allow), consent text, optional mobile OTP (console provider only for now), bot protection, languages (Marathi/Hindi/English with an in-page switch), share text and hashtags.
- **Certificate design**: four starter layouts (classic, modern, minimal, Indian festive), per-block font/size/weight/alignment/colour, background, borders, logos, ordered signatories, QR toggle, and a live preview at every output size. Every save creates a new immutable **template version**.
- **Signatories** (org library): upload a PNG signature with a transparent background, name and designation; reuse across campaigns.

Mobile numbers and emails are encrypted at rest, masked in lists, and revealing one is written to the audit log.

## Fonts

Bundled in `assets/fonts` (works offline): **Noto Serif Devanagari** (default), Noto Sans Devanagari, Mukta, Tiro Devanagari Marathi.
`pnpm fonts:sync` imports the Google Fonts catalogue (about 1,900 families, no API key needed) so the designer can search all of it, filter by script, and shows a curated shortlist first.
A font used by a template is downloaded once into `FONT_CACHE_DIR`, and rendering embeds it from disk. It never depends on a live network call.

## Rendering pipeline

Issuing a certificate (instantly, or on approval) writes a `Certificate` row with a number like `SJA-2026-00042`
(atomic per-campaign counter, configurable prefix), an unguessable 128-bit public id, a snapshot of what is printed on it
(name, campaign, date and fields flagged "show on certificate", **never mobile or email**), and the exact template version used.
It then queues a BullMQ job. The **worker** (`pnpm worker`) keeps one headless Chromium (Playwright) alive, opens an isolated network-less
context per render, waits for embedded fonts to decode, and writes PNG/PDF outputs to storage as each completes:

| Output | Size |
|---|---|
| `square` | 1080×1080 (Instagram / WhatsApp) |
| `story` | 1080×1920 (Stories / Status) |
| `link` | 1200×630 (Facebook / X / LinkedIn preview) |
| `a4` / `pdf` | A4 landscape PNG (1754×1240) and one-page PDF |

Outputs are cached by a content hash (design + data + size + revoked state), so retries and regenerate are cheap. The page at `/c/{id}`
shows a progress state and swaps to the image when ready. If Redis is down when a certificate is issued it stays `QUEUED` and the
worker's sweeper re-queues it. `pnpm certificates:backfill` issues certificates for approved entries that predate this stage.

Chromium shapes Devanagari with HarfBuzz; `tests/rendering.test.ts` renders `बळीराजाची दिवाळी`, `दुष्काळग्रस्त`, `क्ष्म्य`, `श्री`, `र्‍य`
with the embedded font and asserts shaping is active (output differs from unshaped, conjuncts are narrower) plus golden images.
If your Playwright browser lives somewhere unusual set `CHROMIUM_PATH`. Docker: the `worker` image is built on the official Playwright image.
Revoking a certificate re-renders it with a REVOKED stamp, and its `/c/{id}` page shows it as revoked.

## Sharing and publicity

`/c/{id}` carries Open Graph and Twitter Card tags (1200×630 image, absolute URLs, cache-busting hash) so WhatsApp, Facebook, X, LinkedIn and Telegram show the certificate when the link is pasted. The page is `noindex` and shows only name, number, campaign, org and date.
Share buttons: native share (Web Share API **with the image file**, which is the route to Instagram and WhatsApp Status on phones), WhatsApp, Facebook, X, LinkedIn, Telegram, copy link, and Instagram (downloads the image and shows a "now post it" hint).
Each button uses its own tracked link (`?s=whatsapp`, ...), so views are attributed to the platform that produced them. Share clicks and page views per platform appear on the campaign Overview; crawlers and link-preview bots are not counted.
Share text and hashtags are set per campaign (`{{campaign}}`, `{{name}}`, `{{url}}`). Contributors can opt in to a public **wall of contributors** at `/o/{org}/{campaign}/wall` (names only, only for valid certificates).

## Email (Resend)

All mail goes through one module, `src/server/email`. Without `RESEND_API_KEY` it prints to the console. To use Resend:

1. Create an account at resend.com and an **API key** (sending access). Put it in `RESEND_API_KEY`.
2. **Domains -> Add domain** for your platform domain (for example `mail.yourplatform.com`), add the DNS records Resend shows (SPF, DKIM), wait for *Verified*.
3. Set `EMAIL_FROM="KudoBird <certificates@mail.yourplatform.com>"`.
4. **Webhooks -> Add endpoint**: URL `https://YOUR_APP_URL/api/webhooks/resend`, events `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`. Copy the **signing secret** (`whsec_...`) into `RESEND_WEBHOOK_SECRET`. Without it the endpoint refuses all calls.
5. Run the worker (`pnpm worker`). Email is sent from background jobs, never inside a web request.

What is sent: account verification, magic link, password reset and member invites (immediate); the **certificate** to the contributor if they gave an email (PNG attached, link to the page, sent once the render finishes, sent only once unless someone clicks *Resend*); a rejection notice; and new-entry notifications to org members. Each member chooses **instant**, **daily digest (09:00 IST)** or **off** under *Settings -> Notifications*.
Subject and intro text can be overridden per campaign in Marathi, Hindi and English (campaign Overview); otherwise built-in translations are used.
Delivery status (sent, delivered, bounced, complained, ...) appears per entry. A **permanent bounce or a complaint suppresses that address platform-wide**, so no org can mail it again. Soft bounces are recorded but do not suppress.
Contributor emails count against the plan's `emailsPerMonth`; the default sender is the platform domain. A plan-gated custom sender (`customEmailSender`, `Organization.emailFrom` + `emailDomainVerified`) is wired into sending, but the in-app domain verification screen is not built yet.

## Plans and entitlements

`src/server/entitlements.ts` is the only place that decides whether an org may do something
(`assertWithinLimit`, `assertFeature`). Limits/features live on `Plan` rows with per-org overrides, and everyone is on
Free today. Turning on paid plans means editing plan rows, not code. A `PaymentProvider` interface (Razorpay/Stripe) arrives with billing.

## Tests

```bash
pnpm test        # needs the database from above
pnpm typecheck
```

## Deploying

```bash
cp .env.example .env   # set strong secrets and real URLs
docker compose up -d --build
```

Put the `web` service behind a TLS-terminating proxy (Caddy/nginx). Back up Postgres with `pg_dump` on a schedule
(e.g. `pg_dump -Fc "$DIRECT_URL" > kudobird-$(date +%F).dump`) and store dumps off-server.

## Roadmap

1. ✅ Auth, orgs, roles, tenancy
2. ✅ Campaigns, public form, certificate designer
3. ✅ Rendering worker and certificate pages
4. ✅ Sharing and Resend emails (demo checkpoint)
5. Dashboard, bulk issue, audit log
6. Super admin panel
7. API, webhooks, embeds
