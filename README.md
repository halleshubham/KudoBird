# KudoBird

Multi-tenant platform for issuing contribution / participation certificates for any organisation, campaign or event.
Free for now; plans, limits and feature flags are already wired through one entitlement service.

> Status: **All 7 stages built** (auth and tenancy, campaigns and designer, rendering, sharing and email, dashboard and bulk issue, super admin, API/webhooks/embeds). See the roadmap at the bottom.

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
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` | Cloudflare Turnstile bot check on the public form. Unset = bot check is skipped (dev). **Set both in production.** |
| `STORAGE_DRIVER` | `auto` (default): Cloudflare R2 when `R2_ACCOUNT_ID`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set, otherwise local disk (`STORAGE_DIR`). With R2 on, reads that miss R2 fall back to disk, so existing files keep working. `local` / `s3` force one backend. Other S3-compatible stores: set `S3_ENDPOINT` instead of `R2_ACCOUNT_ID`. |
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

On a deployed stack with no shell access, set `SUPER_ADMIN_EMAILS` (comma separated) in the environment and restart: each address is promoted at start-up (created without a password if new). They then use **Email me a sign-in link** on `/login` and enrol 2FA. It only promotes; demote from the admin screens.

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

## Dashboard, bulk issue, audit log

- **Dashboard** (`/app`): certificates issued (all time and this month), pending approvals, entries, views, share clicks, a 30-day chart (hover for numbers, "View as table" for the same data), shares by platform, top campaigns and plan usage.
- **Bulk issue** (campaign -> *Bulk issue*): upload a CSV with `name`, `mobile`, optional `email` and the campaign's custom field keys (a template is downloadable). You see a **preview before anything is created**: valid rows, duplicates (in the file and against existing entries, following the campaign's duplicate policy), invalid rows with reasons, and whether the batch fits the plan's monthly allowance. Mobiles are masked in the preview. Issuing needs an explicit **consent attestation**; emails are only sent if you tick the option. The server re-validates the file on commit; the whole batch is refused if it exceeds the plan limit. Up to 2,000 rows per upload.
- **Audit log** (owners and admins): filterable, paged, with the actor's email, and support access by platform staff is marked.
- **Entries CSV export**: masked by default; a full export (real mobiles/emails) needs the manage-entries permission and is written to the audit log. Every cell is neutralised against spreadsheet formula injection.
- **Org branding**: name, colour and logo under *Settings*; a public page at `/o/{org}` lists the org's active campaigns.

## Privacy (India DPDP Act basics)

Consent text and stated purpose are shown on the form and the consent time and wording are stored per entry. For a request from a person: **Export data** (JSON of everything held about them) and **Erase data** (name, mobile, email and custom answers are irreversibly blanked, images are deleted, the certificate is revoked as "erased"; the number stays so numbering is not disturbed). Both are audit-logged, and need the manage-entries permission. **Retention**: set "Erase contributors' personal data after N days" on a campaign and the worker erases older entries daily (03:30 IST). Mobile numbers and emails are encrypted at rest and masked in lists.

## Public API, webhooks and embeds

Under **Developers** (owners and admins). Plan-gated by the `api` and `webhooks` features (on in Free today).

**REST API** (`/api/v1`, OpenAPI at `/api/v1/openapi.json`). Create a key, send `Authorization: Bearer <key>`. Scopes: `read`, `write` (create entries and issue certificates, revoke), `pii` (include mobile and email; off unless granted). A key belongs to one organisation and can never see another. Keys are shown once; only a keyed hash is stored; revoked, expired and suspended-org keys stop working at once. 300 requests/minute per key (`429` + `Retry-After`). Errors are uniform: `{"error":{"code","message","fields?","request_id"}}`.

```bash
curl $APP_URL/api/v1/campaigns -H "Authorization: Bearer $KEY"
curl -X POST $APP_URL/api/v1/campaigns/$CAMPAIGN_ID/entries -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Asha Rao","mobile":"9876543210","email":"asha@example.com","consent":true,"custom_fields":{"village":"Sinnar"}}'
```

Creating an entry runs the same code as the public form (validation, duplicate policy, approval mode, plan limits, numbering). `consent: true` is required and is recorded as the organisation's attestation. Images render a few seconds later: poll `GET /certificates/{id}` for `render_status`, or use the webhook.

**Webhooks**: `entry.created`, `certificate.issued`, `certificate.revoked`. Each is a signed POST with `X-KudoBird-Event`, `X-KudoBird-Delivery` and `X-KudoBird-Signature: t=<unix>,v1=<hex>`, where `v1` is HMAC-SHA256 of `"{t}.{raw body}"` with the endpoint's signing secret (check it in constant time and reject old timestamps). Reply 2xx within 10 s. Events are written to an outbox **in the same database transaction as the change**, so none is lost; the worker delivers them (`pnpm worker`), retrying 7 times with growing back-off over about a day. An endpoint that fails 20 deliveries in a row is switched off and the owners are emailed. Payloads contain no mobile or email unless the endpoint opted in. URLs must be public `https` addresses: private, loopback, link-local and cloud-metadata destinations are refused both when saving and at connection time (DNS-rebinding safe), redirects are not followed. In development only, `http://localhost` receivers are allowed (set `WEBHOOK_ALLOW_LOCAL=0` to forbid that too).

**Embed the form on your own website**: on the campaign page list the sites allowed to embed it (one per line, `https://www.myngo.org`), then paste the snippet:

```html
<script src="https://YOUR-HOST/embed.js" data-org="my-org" data-campaign="my-campaign" data-lang="mr" async></script>
```

An iframe works too (`/embed/o/{org}/{campaign}`). Embedding is **off until you list a site**, is limited to exactly those sites (`Content-Security-Policy: frame-ancestors`, failing closed), and every other page of the app can only be framed by itself.

## Platform admin panel (`/admin`)

Only users flagged `isSuperAdmin` **who have set up 2FA** can use it. A platform admin without an authenticator is sent to enrol on first sign-in; the panel is unreachable until then. Every admin function also re-checks this in the database, so it does not rely on page guards alone.

| Area | What you can do |
|---|---|
| Overview | Orgs, users, certificates, entries, emails and storage across the platform; 30-day charts of certificates and sign-ups; top orgs; plan mix; email health (bounce/complaint rates); render and email queue depth; failed renders |
| Organisations | Search; create an org for an owner (existing user becomes owner, otherwise an invitation is emailed); change plan; per-org limit and feature overrides; suspend / reactivate; delete (recoverable) and **purge** (needs prior deletion and typing the org's address; removes all data and stored files) |
| Support access | Sign in as an org member to help them. Requires a written reason; refuses other admins, disabled users, non-members and inactive orgs; lasts 60 minutes; is **pinned to that one organisation**; is recorded in the org's own audit log and a support-access log its owners/admins can read; **owners are emailed**; actions taken are attributed to the admin; an "End support session" bar is always visible |
| Users | Search; disable (signs them out everywhere); send a password reset; reset 2FA; promote / demote platform admins (not yourself) |
| Plans | Create and edit plans (limits and feature flags). This is how paid tiers get switched on later: edit plans here, no code changes |
| Templates | Manage the starter gallery (create from a preset, edit design JSON as a new version, rename, delete). Organisations that cloned one keep their copy |
| Fonts | Sync the Google Fonts catalogue, curate the shortlist (a re-sync never overwrites your curation), pre-cache a font so its first render never needs the network |
| Settings | Open/close new sign-ups, which plan new orgs start on, an announcement banner |
| Audit | Platform-level actions (settings, plans, fonts, user management, impersonation) and every organisation's audit log in one place |

A suspended organisation: members see a "Workspace unavailable" page, its public form stops accepting entries and its public page disappears. Certificates already issued stay verifiable at `/c/{id}`.

## Plans and entitlements

`src/server/entitlements.ts` is the only place that decides whether an org may do something
(`assertWithinLimit`, `assertFeature`). Limits/features live on `Plan` rows with per-org overrides, and everyone is on
Free today. Turning on paid plans means editing plan rows, not code. A `PaymentProvider` interface (Razorpay/Stripe) arrives with billing.

## Tests

```bash
pnpm test        # needs the database from above
pnpm typecheck
```

## Container images and deployment

**Images** (public, linux/amd64) are built by GitHub Actions (`.github/workflows/ci.yml`) on every push, **only after** the typecheck and the full test suite pass against real Postgres and Redis:

| Image | Contents |
|---|---|
| `ghcr.io/halleshubham/kudobird-web` | The Next.js app. On start it runs `scripts/bootstrap.ts`: waits for Postgres, creates/refreshes the restricted application role, runs migrations, loads reference data (Free plan, bundled fonts, starter templates) and **refuses to start if the application role could bypass Row Level Security**. |
| `ghcr.io/halleshubham/kudobird-worker` | The background worker with headless Chromium (renders certificates, sends email, delivers webhooks, retention, digests). |

Tags: `sha-<short commit>` (immutable, use this for deployments), the branch name, `v*` release tags, and `latest` (default branch only). Packages are private by default on GitHub: after the first publish, open each package (Profile > Packages > kudobird-web / kudobird-worker > Package settings) and set the visibility to **Public** so servers can pull without credentials.

**Deploy with Coolify (or any Docker host).** `deploy/docker-compose.coolify.yml` is the whole production stack: Postgres, Redis, web, worker and a nightly backup job. Web and worker share one `/data` volume (uploads, rendered certificates, font cache), which is why they must run in the same stack unless you configure Cloudflare R2. To move existing files to R2: set the R2 variables, redeploy, then run `pnpm storage:migrate` inside the web container (add `--delete-local` once you are happy).

1. In Coolify create a *Docker Compose* service from that file, point the domain at the **web** service on port **3000**, and set the variables listed at the top of the file. Generate long random values for `AUTH_SECRET`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` and `REDIS_PASSWORD`.
2. Set `IMAGE_TAG` to the commit you want (for example `sha-1a2b3c4`) and deploy. The first start takes a minute or two (the database is created and migrated).
3. **Back up `AUTH_SECRET` somewhere safe.** It derives the keys that encrypt contact details; if it is lost those details cannot be read.
4. Create the first platform admin from the web container's terminal: `node_modules/.bin/tsx scripts/create-super-admin.ts you@example.org 'a long password'`. You are asked to set up 2FA at first sign-in.
5. Add `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` (see *Email*) so verification links, certificates and notifications are actually emailed; without a key they are only printed in the container log. Add `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` to protect the public form from bots. Without them there is no bot protection.

**Updating:** change `IMAGE_TAG` and redeploy. Migrations run automatically and are additive. To roll back, set the previous tag (migrations that already ran stay applied, so keep migrations backward compatible).

**Backups.** The `backup` service writes a compressed `pg_dump` every night into the `backups` volume (7 daily, 4 weekly, 6 monthly kept). That volume lives on the same server, so also copy it elsewhere (for example a scheduled `rclone`/`rsync` of the volume, or Coolify's S3 backup destination), and test a restore:

```bash
gunzip -c /backups/last/kudobird-latest.sql.gz | psql "$DIRECT_URL"   # into an empty database
```

Also back up the `appdata` volume (rendered certificates and uploads) if you cannot afford to re-render; or use S3-compatible storage with its own versioning.

**Local containers:** `docker compose up -d postgres redis` for just the databases, or `docker compose --profile app up --build` to run the same web and worker containers locally.

## Roadmap

1. ✅ Auth, orgs, roles, tenancy
2. ✅ Campaigns, public form, certificate designer
3. ✅ Rendering worker and certificate pages
4. ✅ Sharing and Resend emails (demo checkpoint)
5. ✅ Dashboard, bulk issue, audit log
6. ✅ Super admin panel
7. ✅ API, webhooks, embeds

## Design and UX
Screens follow [docs/ui-ux-guidelines.md](docs/ui-ux-guidelines.md). Run `pnpm ux:audit` against a running, seeded app to check accessibility and mobile layout. History of the last audit: [docs/ux-audit.md](docs/ux-audit.md).

## Email verification
New accounts must verify their email before they can sign in: sign-up creates the account and sends a link, but no session. Password sign-in, and any existing session, is refused until the address is verified (magic-link and Google sign-in verify it by themselves). Links last 24 hours and can be resent once a minute from `/verify-email`. Accounts created before this rule are treated the same way: on their next sign-in they receive a link. Seeded and `create-super-admin` accounts are created verified.

## Image storage
Rendered certificate PNGs are re-encoded as optimised palette PNGs by the worker before storing (about 80% smaller, visually identical). Uploaded backgrounds, logos and signatures are optimised on upload: the longest side is capped (2400 px for backgrounds, 1200 px for logos and signatures), opaque photos become progressive JPEG, transparent images and flat artwork stay palette PNG, SVG is stored as is. The storage quota counts the stored size.
