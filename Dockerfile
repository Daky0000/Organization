# ── Stage 1: Build web frontend ───────────────────────────────────────────────
FROM node:24-alpine AS web-builder
WORKDIR /app

COPY package*.json ./
COPY packages/web/package*.json ./packages/web/

RUN npm ci --include=dev --no-audit --no-fund --workspace @contentflow/web

COPY packages/web ./packages/web

# VITE_* vars are baked in at build time; if unset, relative paths are used (same-origin)
ARG VITE_API_BASE_URL
ARG VITE_APP_URL
ARG VITE_SENTRY_DSN
ARG VITE_INSTAGRAM_APP_ID
ARG VITE_TWITTER_CLIENT_ID
ARG VITE_LINKEDIN_CLIENT_ID
ARG VITE_FACEBOOK_APP_ID
ARG VITE_TIKTOK_CLIENT_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_APP_URL=$VITE_APP_URL \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_INSTAGRAM_APP_ID=$VITE_INSTAGRAM_APP_ID \
    VITE_TWITTER_CLIENT_ID=$VITE_TWITTER_CLIENT_ID \
    VITE_LINKEDIN_CLIENT_ID=$VITE_LINKEDIN_CLIENT_ID \
    VITE_FACEBOOK_APP_ID=$VITE_FACEBOOK_APP_ID \
    VITE_TIKTOK_CLIENT_ID=$VITE_TIKTOK_CLIENT_ID

RUN npm run build --workspace @contentflow/web

# ── Stage 2: Compile API TypeScript ───────────────────────────────────────────
FROM node:24-alpine AS api-builder
WORKDIR /app

# Prisma's engine detection needs openssl on alpine. Generating inside this
# image is also what makes "native" resolve to the musl engine the runtime
# stage will actually load.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

# Dependencies are installed before the source is copied, for layer caching, so
# prisma/schema.prisma does not exist yet — the api package's postinstall skips
# rather than failing. `npm run build` below runs `prisma generate` for real.
RUN npm ci --include=dev --no-audit --no-fund --workspace @contentflow/api

COPY packages/api ./packages/api
COPY scripts ./scripts

RUN npm --workspace @contentflow/api run build

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm ci --omit=dev --no-audit --no-fund --workspace @contentflow/api

# The server bundle is built with --packages=external, so @prisma/client is
# resolved from node_modules at runtime — and a freshly installed one throws
# until `prisma generate` has run against the schema. The CLI that does that is
# a devDependency and is not in this stage, so the generated client is copied
# from the builder instead. Both paths are needed: @prisma/client is the facade,
# .prisma/client holds the generated types and the query engine binary.
COPY --from=api-builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=api-builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=api-builder /app/packages/api/.railway-build ./packages/api/.railway-build
COPY --from=web-builder /app/packages/web/dist ./packages/api/.railway-build/public

USER node

EXPOSE 5000

CMD ["node", "packages/api/.railway-build/server.mjs"]
