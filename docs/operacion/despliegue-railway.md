# Despliegue en línea con Railway

Decisión y presupuesto: [ADR-0025](../adr/0025-despliegue-en-linea-railway.md). **Estado: preparado; todavía no desplegado.** Esta guía describe el procedimiento para cuando el propietario autorice el gasto.

> **Presupuesto.** Hobby incluye 5 USD de uso y el hard limit mínimo documentado es de 10 USD, así que no hay un corte efectivo a 5 USD. Antes de crear recursos, el propietario decide entre las opciones del ADR-0025 §2. Configure siempre un aviso por correo (límite blando) bajo el consumo incluido y revise *Workspace → Usage*.

## 1. Servicios

| Servicio | Contenido | Volumen |
|---|---|---|
| `softarq` | Imagen del `Dockerfile` (API + panel compilado, mismo origen https); `railway.json` fija el healthcheck `/health` y una réplica | Sí: PDF emitidos |
| `postgres` | PostgreSQL 18 solo por red privada; sin proxy TCP público | Sí |

No cree servicios para `mobile`, `api` ni `web` por separado ni acepte la detección automática del monorepo: se descarta el asistente («Apply … changes») y se configura `softarq` desde la raíz del repositorio con el Dockerfile. Sin despliegues automáticos de PR ni entornos adicionales.

## 2. Variables del servicio `softarq`

| Variable | Valor |
|---|---|
| `SOFTARQ_DESPLIEGUE`, `NODE_ENV` | `nube`, `production` (ya fijadas en la imagen) |
| `API_PUBLIC_URL` | origen público https del servicio, p. ej. `https://<dominio>` (sin ruta ni puerto) |
| `VITE_API_URL` | el mismo origen; es un argumento de compilación (la web se compila con él) |
| `DATABASE_URL` | URL del rol `softarq_app` con el host `*.railway.internal` |
| `SOFTARQ_DIR_DOCUMENTOS` | punto de montaje del volumen, p. ej. `/data/documentos` |
| `SOFTARQ_DIR_WEB` | `/app/apps/web/dist` (en la imagen) |
| `PORT` | lo inyecta Railway |

Las contraseñas de los roles son nuevas y se generan para la nube; nunca se reutilizan las locales ni se suben a Git.

## 3. Primer despliegue

1. **Roles** (una vez; superusuario del PostgreSQL de Railway; contraseñas ≥ 32 caracteres en variables de la sesión):
   `pnpm --filter @softarq/api db:aprovisionar:nube` con `ADMIN_DATABASE_URL`, `SOFTARQ_MIGRATOR_PASSWORD` y `SOFTARQ_APP_PASSWORD`.
2. **Datos:** restaurar en la base de Railway un respaldo **verificado** (`respaldo:crear` + `respaldo:verificar` en local), sin tocar `softarq_dev`; después revocar todas las sesiones restauradas.
3. **Migraciones controladas:** `pnpm --filter @softarq/api db:migrar:nube -- --respaldo-verificado` con `MIGRATION_DATABASE_URL` del rol migrador (no se ejecutan al arrancar).
4. **Desplegar** `softarq`, comprobar `GET /health` y recorrer el flujo con cuentas QA.

## 4. APK conectada

```
pnpm --filter @softarq/mobile eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://<dominio> --visibility plaintext
pnpm --filter @softarq/mobile eas build --platform android --profile interna
```

El perfil `interna` genera un APK de distribución interna con el JavaScript incluido y falla si la URL no es el origen https público. El archivo de subida es el de `.easignore` (lista blanca; sin secretos).

## 5. Actualizar, respaldar y detener

- **Actualizar:** subir el commit; Railway reconstruye la imagen. Si hay migraciones: respaldo verificado → `db:migrar:nube`.
- **Respaldar:** `respaldo:crear`/`verificar` (con `SOFTARQ_PG_BIN` en Linux) y cifrar con `respaldo:cifrar-aead` (clave `SOFTARQ_RESPALDO_CLAVE_AEAD` generada con `respaldo:aead-clave`, guardada en el gestor de secretos y separada del respaldo); Vigenère sigue disponible (`respaldo:cifrar`). Restaurar solo en una base independiente.
- **Detener:** retirar el despliegue de `softarq` y `postgres` (o escalarlos a cero) cuando no se use el DEMO; los volúmenes conservan datos y documentos.
