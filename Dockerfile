# Imagen única de SoftArq para la nube (ADR-0025): la API sirve también el panel compilado, en el mismo origen.
# Reproducible: pnpm con lockfile congelado. VITE_API_URL (origen https público) llega como argumento de compilación.
FROM node:24.11.1-bookworm-slim AS base
ENV CI=true
# openssl: Prisma elige el motor de migraciones según la versión de OpenSSL; debe ser la misma al compilar y al ejecutar.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
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
 && pnpm --filter @softarq/web build && pnpm --filter @softarq/api exec prisma version

FROM base AS ejecutar
ENV NODE_ENV=production SOFTARQ_DESPLIEGUE=nube SOFTARQ_DIR_WEB=/app/apps/web/dist SOFTARQ_PG_BIN=/usr/lib/postgresql/18/bin
# Cliente de PostgreSQL 18 (pg_dump, pg_restore, psql) para la carga inicial y los respaldos dentro del servicio.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg  && install -d /usr/share/postgresql-common/pgdg  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18  && rm -rf /var/lib/apt/lists/*
COPY --from=construir /app /app
WORKDIR /app/apps/api
EXPOSE 8080
# El volumen se monta como root: el punto de entrada lo prepara y baja a un usuario sin privilegios (node queda como PID 1:
# recibe SIGTERM y la API se apaga de forma ordenada).
ENTRYPOINT ["sh", "scripts/nube/entrypoint.sh"]
