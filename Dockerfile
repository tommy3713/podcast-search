# syntax=docker/dockerfile:1
# Two images from one file: `--target web` (Next.js standalone) and `--target worker`.
# Built by GitHub Actions; never on the 2GB VPS.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

# Toolchain only in case better-sqlite3 has no prebuilt binary for this Node
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY worker ./worker
USER node
CMD ["node", "--import", "tsx", "worker/main.ts", "run"]
