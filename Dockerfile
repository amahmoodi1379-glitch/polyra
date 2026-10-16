# Polyra: one image, one Node process (PRD §15.1). Built by the host from this file.
# Node is pinned so the server runs the version the tests ran on.

FROM node:22.22.2-alpine AS build
WORKDIR /app

# Manifests and the Prisma schema first, so `npm ci` (whose postinstall runs `prisma generate`)
# is cached until dependencies or the schema change.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# --include=dev on purpose: some hosts pass NODE_ENV=production to the build too, and npm would then
# skip the build tools.
RUN npm ci --include=dev

COPY . .
# Git does not keep an empty folder, so a fresh clone may have no public/; the runtime stage copies it.
RUN mkdir -p public
# The database is not reachable while building; the address below only lets modules load, and no
# page reads data at build time. The real address comes from the host at run time.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build NEXT_TELEMETRY_DISABLED=1 npm run build

# Keep only what runs on the server (prisma and tsx stay: migrations and the seed run at start).
RUN npm prune --omit=dev && rm -rf .next/cache

FROM node:22.22.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 STORAGE_DIR=/app/storage

COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
# Read at run time: the seed loads the frequency lists, the panel reads the prompt templates.
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/prompts ./prompts
# The French demo for testers, loaded at start when DEMO_CONTENT=fr.
COPY --from=build --chown=node:node /app/fixtures ./fixtures
COPY --from=build --chown=node:node --chmod=755 /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Uploaded audio lives here; on the host this folder is a mounted disk.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
