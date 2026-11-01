# syntax=docker/dockerfile:1
# Two runnable images from one build:  --target web  and  --target worker
# Both run the app from the full build tree with `next start` / tsx, the same way it is run in development and in tests.

# ---------------------------------------------------------------- build
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
# Placeholders only for the build step (not stored in the image): config is validated at runtime, not at build time.
RUN pnpm exec prisma generate \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build DIRECT_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder-not-used-at-runtime-0123456789 APP_URL=http://localhost:3000 pnpm exec next build

# ---------------------------------------------------------------- shared runtime base
FROM node:22-slim AS runtime
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STORAGE_DIR=/data/files FONT_CACHE_DIR=/data/fonts
LABEL org.opencontainers.image.source="https://github.com/halleshubham/KudoBird" org.opencontainers.image.licenses="see LICENSE"
# The web server and the worker share one /data volume, so both run as the same user (node, uid 1000).
RUN mkdir -p /data/files /data/fonts && chown -R node:node /data
COPY --from=build --chown=node:node /app /app

# ---------------------------------------------------------------- web
FROM runtime AS web
ENV PORT=3000 HOSTNAME=0.0.0.0
USER node
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# bootstrap: create/refresh the restricted DB role, run migrations, load reference data, verify tenant isolation, then serve
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/bootstrap.ts && exec node_modules/.bin/next start -p 3000 -H 0.0.0.0"]

# ---------------------------------------------------------------- worker (headless Chromium for rendering)
FROM runtime AS worker
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright CHROMIUM_NO_SANDBOX=1
# Installs exactly the Chromium that matches the installed playwright package, plus its system libraries.
RUN node_modules/.bin/playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/*
USER node
VOLUME /data
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]
