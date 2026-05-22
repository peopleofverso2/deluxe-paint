# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------
# Stage 1 — build the api-server (esbuild bundle) and the Vite SPA
# ----------------------------------------------------------------------
FROM node:24-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Workspace root + lockfile + tsconfig
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./

# Per-package manifests for pnpm workspace resolution
COPY scripts/package.json scripts/tsconfig.json scripts/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY artifacts/deluxe-paint/package.json artifacts/deluxe-paint/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/

RUN pnpm install --frozen-lockfile

# Sources
COPY lib ./lib
COPY artifacts/deluxe-paint ./artifacts/deluxe-paint
COPY artifacts/api-server ./artifacts/api-server

# Build the SPA
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/deluxe-paint run build

# Build the api-server (esbuild bundles to dist/index.mjs)
RUN pnpm --filter @workspace/api-server run build

# ----------------------------------------------------------------------
# Stage 2 — Node runtime serving BOTH the api-server and the static SPA
# ----------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

# Copy only what's needed at runtime:
# - api-server bundle
# - static SPA assets under ./public (where api-server's app.ts looks)
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/deluxe-paint/dist/public ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# The bundle is fully self-contained (esbuild --bundle). No node_modules
# needed at runtime, which keeps the image small.
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
