# syntax=docker/dockerfile:1.7
# Многоэтапная сборка: итоговый образ содержит только production-зависимости,
# запускается от непривилегированного пользователя.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @omni/server && npm cache clean --force
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/seed-assets ./apps/server/seed-assets
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
