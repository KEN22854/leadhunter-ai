# LEADHUNTER AI — production-образ (SQLite в томе /data).
# AI в контейнере работает только через ANTHROPIC_API_KEY: Claude Code CLI и его вход живут на вашем компьютере.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 app && mkdir -p /data /app/workspace && chown -R app /data /app
ENV NODE_ENV=production \
    DATABASE_URL=file:/data/leadhunter.db \
    WORKSPACE_DIR=/app/workspace \
    AI_PROVIDER=anthropic
COPY --from=build --chown=app /app ./
USER app
EXPOSE 3210
VOLUME ["/data", "/app/workspace"]
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
