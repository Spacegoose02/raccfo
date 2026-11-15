# raccfo: one small container, no npm dependencies.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    SITE_DIR=/app/site \
    CONFIG_DIR=/config

WORKDIR /app
COPY package.json server.js ./
COPY site ./site

RUN mkdir -p /config && chown node:node /config
USER node

EXPOSE 8080
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
