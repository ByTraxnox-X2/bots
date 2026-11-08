# BW BOT PREMIUM - imagen de producción (misma base de código que Termux/VPS)
# Etapa 1: dependencias. algunas dependencias de Baileys pueden instalarse desde GitHub, por eso se incluye git.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
# Con package-lock.json usa instalación reproducible; sin él (primer build) instala y resuelve versiones.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

# Etapa 2: imagen final, sin git ni caché de apt, ejecutada como usuario sin privilegios.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    BW_IN_DOCKER=1 \
    DATA_DIR=/app/data \
    SESSION_DIR=/app/data/session \
    BACKUP_DIR=/app/data/backups \
    LOG_DIR=/app/data/logs \
    TMP_DIR=/app/data/tmp \
    HEALTH_PORT=3000 \
    HEALTH_HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node
# Sesión de WhatsApp, base de datos, backups y logs viven aquí: montar un volumen para que persistan.
VOLUME ["/app/data"]
EXPOSE 3000
# Liveness: el proceso responde. Sin curl: usa el propio Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.HEALTH_PORT||3000,path:'/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "index.js"]
