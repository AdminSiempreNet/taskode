FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# The VAPID public key is inlined into client JavaScript at build time; it is not a secret.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:migrator && npm run build:check

FROM node:24-bookworm-slim AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist/migrate.cjs ./dist/migrate.cjs
COPY --from=builder /app/drizzle/postgresql ./drizzle/postgresql
USER node
CMD ["node", "dist/migrate.cjs"]

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=5010 HOSTNAME=0.0.0.0 BACKUP_DIR=/app/backups ATTACHMENT_DIR=/app/attachments TZ=America/Bogota
RUN mkdir -p /app/backups /app/attachments && chown node:node /app/backups /app/attachments
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle/postgresql ./drizzle/postgresql
COPY --from=builder --chown=node:node /app/dist/migrate.cjs /app/dist/check-production.cjs ./dist/
COPY --chown=node:node scripts/docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 5010
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:5010/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "docker-entrypoint.sh"]
