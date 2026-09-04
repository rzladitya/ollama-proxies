# ── Build Stage ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN npm ci
RUN npm run build

# ── Production Stage ──
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV OLLAMA_PROXY_HOST=0.0.0.0
ENV OLLAMA_PROXY_PORT=11435
ENV OLLAMA_PROXY_DATA_DIR=/app/data

# Copy sources (package manifests drive the workspace install)
COPY package*.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Copy compiled output from the build stage — never from the host
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/ollama-client/dist ./packages/ollama-client/dist
COPY --from=builder /app/packages/routing-core/dist ./packages/routing-core/dist
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Clean dev dependencies for lean runtime image
RUN npm ci --omit=dev

# Pre-create data volume directory
RUN mkdir -p /app/data

EXPOSE 11435

# Use dumb-init for clean PID 1 signal forwarding (graceful shutdown)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/server/dist/main.js"]
