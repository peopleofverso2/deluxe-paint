# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------
# Stage 1 — build the deluxe-paint Vite app inside the pnpm workspace
# Use the Debian slim image (glibc) — the workspace's pnpm overrides
# only ship linux-x64-gnu native binaries (lightningcss, tailwindcss-oxide,
# rollup), so Alpine/musl won't resolve them.
# ----------------------------------------------------------------------
FROM node:24-slim AS builder
WORKDIR /app

# Pin pnpm to a version that the workspace's preinstall script accepts.
# Corepack defaults to v11 which sets `npm_config_user_agent=corepack/...`
# and trips the "Use pnpm instead" guard in the root package.json.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Workspace root + lockfile + tsconfig
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./

# Per-package manifests — pnpm needs them all for workspace resolution
COPY scripts/package.json scripts/tsconfig.json scripts/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY artifacts/deluxe-paint/package.json artifacts/deluxe-paint/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/

RUN pnpm install --frozen-lockfile

# Now copy sources we need for the build
COPY lib ./lib
COPY artifacts/deluxe-paint ./artifacts/deluxe-paint

# Vite config requires PORT + BASE_PATH at build time
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/deluxe-paint run build

# ----------------------------------------------------------------------
# Stage 2 — tiny static-file runtime (no node_modules carried over)
# ----------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

# `serve` is a small SPA-friendly static-file server. -s rewrites unknown
# routes to index.html, which is what we want for a wouter client-router app.
RUN npm install -g serve@14

COPY --from=builder /app/artifacts/deluxe-paint/dist/public ./public

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "serve -s public -l tcp://0.0.0.0:${PORT:-8080}"]
