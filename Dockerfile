# No `# syntax=` directive on purpose. It makes BuildKit fetch a frontend image
# from Docker Hub before it can parse this file, which fails on a build server
# with restricted registry access. Nothing here needs a newer frontend than the
# one built into the daemon.

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
# modules, so the compiled Worker needs nothing from node_modules at runtime
# beyond Miniflare and the workerd binary it launches. Everything that only
# builds or lints is dropped before the runtime stage copies the tree.
RUN rm -rf \
      node_modules/@img \
      node_modules/@next \
      node_modules/@rolldown \
      node_modules/@tailwindcss \
      node_modules/@vitejs \
      node_modules/drizzle-kit \
      node_modules/drizzle-orm \
      node_modules/esbuild \
      node_modules/eslint \
      node_modules/eslint-config-next \
      node_modules/lucide-react \
      node_modules/next \
      node_modules/tailwindcss \
      node_modules/typescript \
      node_modules/vite \
      node_modules/wrangler

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Traefik forwards client headers verbatim, so the Sites identity header must
# not be treated as proof of identity here. Admins sign in at /masuk instead.
ENV NODE_ENV=production \
    PORT=3000 \
    OUTBOUND_TRUST_PLATFORM_AUTH=false \
    OUTBOUND_STATE_DIR=/data/wrangler-state

# Miniflare is the runtime here and it is a devDependency, so the resolved tree
# is carried over rather than reinstalled.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json

# Local D1 and R2 live here. Mount a Docker volume on /data, otherwise every
# redeploy starts from an empty database.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

# Any HTTP answer proves workerd is serving. Auth redirects and 401 are healthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/`).then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "scripts/serve.mjs"]
