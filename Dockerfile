# syntax=docker/dockerfile:1

# Cloudflare publishes workerd, the runtime `wrangler dev` boots, as glibc-only
# builds, so this image stays on Debian slim instead of Alpine.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# The build tooling (vinext, vite, wrangler) lives in devDependencies, so this
# install must not be pruned with --omit=dev.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# The generated config sets `no_bundle` and the build reports no external
# modules, so the compiled Worker needs nothing from node_modules at runtime.
# Dropping the compiler and linter toolchain before the runtime stage copies
# the tree keeps the deployed image roughly a gigabyte smaller.
RUN rm -rf \
      node_modules/@img \
      node_modules/@next \
      node_modules/@rolldown \
      node_modules/@tailwindcss \
      node_modules/@vitejs \
      node_modules/drizzle-kit \
      node_modules/eslint \
      node_modules/eslint-config-next \
      node_modules/lucide-react \
      node_modules/next \
      node_modules/tailwindcss \
      node_modules/typescript \
      node_modules/vite

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Traefik forwards client headers verbatim, so the Sites identity header must
# not be treated as proof of identity here. Admins sign in at /masuk instead.
ENV NODE_ENV=production \
    CI=true \
    PORT=3000 \
    OUTBOUND_TRUST_PLATFORM_AUTH=false \
    OUTBOUND_STATE_DIR=/data/wrangler-state \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_WRITE_LOGS=false \
    MINIFLARE_REGISTRY_PATH=/tmp/miniflare-registry

# Wrangler is the runtime for a self-hosted Worker, and it is a devDependency,
# so the resolved tree is carried over rather than reinstalled.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json

# dist/server/wrangler.json resolves `migrations_dir` to <root>/migrations.
COPY --from=build --chown=node:node /app/drizzle/*.sql ./migrations/

# Local D1 and R2 live here. Mount a Docker volume on /data, otherwise every
# redeploy starts from an empty database.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

# Any HTTP answer proves workerd is serving. Auth redirects and 401 are healthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/`).then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "scripts/start-container.mjs"]
