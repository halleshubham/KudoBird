# KudoBird

Multi-tenant platform for issuing contribution / participation certificates for any organisation, campaign or event.
Free for now; plans, limits and feature flags are already wired through one entitlement service.

> Status: **Stage 2 of 7** (campaigns, public form, certificate designer). See the roadmap at the bottom.

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
| `RESEND_API_KEY`, `EMAIL_FROM` | Email delivery |
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
3. Rendering worker and certificate pages
4. Sharing and Resend emails (demo checkpoint)
5. Dashboard, bulk issue, audit log
6. Super admin panel
7. API, webhooks, embeds
