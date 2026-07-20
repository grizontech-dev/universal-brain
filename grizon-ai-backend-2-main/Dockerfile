FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./dist/db/migrations
COPY package.json ./

# Ephemeral dev keys only when PEMs are absent in the image; a bind/volume at /app/secrets replaces this at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && mkdir -p /app/secrets \
  && if [ ! -f /app/secrets/jwt-private.pem ] || [ ! -f /app/secrets/jwt-public.pem ]; then \
       openssl genrsa -out /app/secrets/jwt-private.pem 2048 \
       && openssl rsa -in /app/secrets/jwt-private.pem -pubout -out /app/secrets/jwt-public.pem; \
     fi \
  && chown -R node:node /app/secrets \
  && apt-get purge -y openssl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

USER node

CMD ["sh", "-c", "node dist/db/migrations/run.js && node dist/db/seed.js && node dist/index.js"]
