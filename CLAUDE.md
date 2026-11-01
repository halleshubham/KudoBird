# KudoBird: notes for Claude

Multi-tenant certificate SaaS (Next.js 15, Prisma/Postgres with RLS, BullMQ worker, Playwright rendering). See `README.md` for architecture, deployment and the API.

## Always
- Tests: `pnpm typecheck && pnpm test` (needs Postgres and Redis running). `tests/structure.test.ts` enforces architecture rules (UI never imports `@/server/db`, only certain files decrypt PII, services call `assertCan`, no `window.confirm`). Do not weaken those tests to make a change pass.
- Never put secrets in the repo or commit messages. Deployment secrets live in Coolify.

## Any UI or UX change
**Read `docs/ui-ux-guidelines.md` first and follow it.** In short: reuse the shared components in `src/components/`, confirm destructive actions with `ConfirmButton`, give every control a label, handle empty/error/pending states, check at 390px width, and run `pnpm ux:audit` (must report zero issues) and look at the screenshots before declaring the work done. Background and history: `docs/ux-audit.md`.

## Rendering and designer
The certificate HTML is produced by the pure function `renderCertificateHtml` (`src/server/render/html.ts`), used both by the browser preview and the Chromium worker. Design JSON changes must stay backward compatible (add fields with defaults) and be covered in `tests/design-fields.test.ts`.

## Storage
`STORAGE_DRIVER=auto`: Cloudflare R2 when the R2/S3 variables are set, local disk otherwise (reads fall back to disk). `pnpm storage:migrate` copies old files to R2.
