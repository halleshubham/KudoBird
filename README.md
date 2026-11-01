# KudoBird

Multi-tenant platform for issuing contribution / participation certificates for any organisation, campaign or event.
Free for now; plans, limits and feature flags are already wired through one entitlement service.

> Status: **Stage 1 of 7** (auth, organisations, roles, tenancy). See the roadmap at the bottom.

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL + Prisma · Redis/BullMQ (stage 3) · Playwright (stage 3) · Resend + React Email · Tailwind 3 · pnpm.

## Local setup

Requirements: Node 22, pnpm 10, PostgreSQL 16, Redis 7 (Docker Compose provides both).

```bash
pnpm install
cp .env.example .env          # edit AUTH_SECRET (32+ random chars)
docker compose up -d postgres redis
pnpm exec prisma migrate deploy
pnpm db:seed                  # creates the Free plan
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

The environment is validated at startup; the app refuses to run with a clear message if something is missing or invalid.

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
2. Campaigns, public form, certificate designer
3. Rendering worker and certificate pages
4. Sharing and Resend emails (demo checkpoint)
5. Dashboard, bulk issue, audit log
6. Super admin panel
7. API, webhooks, embeds
