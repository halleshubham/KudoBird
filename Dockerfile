# --- build ---------------------------------------------------------------
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate && pnpm exec next build

# --- web: Next.js server (no browser inside) ------------------------------
FROM node:22-slim AS web
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/files FONT_CACHE_DIR=/data/fonts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/assets ./assets
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]

# --- worker: BullMQ + Playwright Chromium ---------------------------------
# The Playwright base image ships Chromium and its system libraries; keep its tag in step with the playwright package version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS worker
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production STORAGE_DIR=/data/files FONT_CACHE_DIR=/data/fonts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/tsconfig.json ./
COPY --from=build /app/src ./src
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/assets ./assets
CMD ["pnpm", "worker"]
