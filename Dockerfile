# docket-server: sync relay + AI + MCP, also serving the web app at /.
FROM node:26-slim AS build
WORKDIR /src
RUN npm install -g pnpm@8.7.5 >/dev/null
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @ai-todo/server... --filter @ai-todo/web...
COPY packages/core packages/core
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @ai-todo/web build && pnpm --filter @ai-todo/server build

FROM node:26-slim
ENV NODE_ENV=production DOCKET_DATA_DIR=/data DOCKET_WEB_DIR=/app/web DOCKET_PORT=8787
WORKDIR /app
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
