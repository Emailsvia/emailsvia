# Railway image. Multi-stage: full deps only exist in the build stages; the
# runtime stage ships Next's standalone output (traced node_modules only).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined at build time. Railway passes service variables
# to the build only when they're declared as ARGs.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_GA_ID
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_AUTH_TOKEN
ENV NEXT_TELEMETRY_DISABLED=1
# Type-checking OOMs container builders even at a 4GB heap — skipped here,
# run `npx tsc --noEmit` before deploying (see next.config.ts).
ENV SKIP_TYPECHECK=1 \
    NODE_OPTIONS=--max-old-space-size=3072
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    # Large Supabase auth cookie chains (see package.json) + a heap ceiling
    # well under the container memory limit in railway.json.
    NODE_OPTIONS="--max-http-header-size=32768 --max-old-space-size=384"
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
