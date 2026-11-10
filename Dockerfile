FROM node:26-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --no-create-home app \
    && mkdir -p /data \
    && chown app:app /data

COPY --chown=app:app package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app fixtures ./fixtures
COPY --chown=app:app scripts ./scripts

USER 10001:10001

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((response) => response.json().then((body) => { if (!response.ok || body.status !== 'ok') process.exit(1); })).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
