# Imagen única de SoftArq para la nube (ADR-0025): la API sirve también el panel compilado, en el mismo origen.
# Reproducible: pnpm con lockfile congelado. VITE_API_URL (origen https público) llega como argumento de compilación.
FROM node:24.11.1-bookworm-slim AS base
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate
WORKDIR /app

FROM base AS construir
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @softarq/api... --filter @softarq/web...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @softarq/contracts build \
 && pnpm --filter @softarq/api build \
 && pnpm --filter @softarq/web build

FROM base AS ejecutar
ENV NODE_ENV=production SOFTARQ_DESPLIEGUE=nube SOFTARQ_DIR_WEB=/app/apps/web/dist
COPY --from=construir /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 8080
# Apagado ordenado: Node recibe SIGTERM directamente (sin shell intermedio).
CMD ["node", "dist/main.js"]
