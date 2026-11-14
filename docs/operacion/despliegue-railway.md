# Despliegue en línea con Railway

Decisión y presupuesto: [ADR-0025](../adr/0025-despliegue-en-linea-railway.md). **Estado: desplegado y verificado el 14/11/2026.**

- **Panel y API (mismo origen https):** https://softarq-production.up.railway.app
- **Proyecto:** `upbeat-alignment`, entorno `production`, workspace Hobby. Dos servicios: `softarq` (API + panel, volumen en `/data`) y `Postgres` (PostgreSQL 18, volumen propio, solo red privada, sin proxy TCP público).
- Los datos son DEMO. Las contraseñas de las cuentas de la nube no están en el repositorio: viven en `_work/secrets/nube-railway.json` de la laptop del propietario.

## Control del gasto (workspace)

Ciclo de facturación: **14/11/2026 – 14/12/2026** (renovación el 14/12/2026). Límites configurados y verificados con `railway usage limit status`:

| Límite | Valor | Efecto |
|---|---|---|
| Alerta por correo (blanda) | 5 USD | Solo avisa |
| Hard limit del workspace | 10 USD | Apaga todas las cargas al alcanzarlo |
| Railway Agent | 0 USD (bloqueado) | No se usa |

El límite cubre cómputo, almacenamiento y egreso. **No es una garantía de la factura final**: no incluye la suscripción Hobby de 5 USD ni impuestos, y un servicio apagado por el límite deja los volúmenes con sus datos. Consulte el consumo con `railway usage` y `railway metrics --all`. No suba ni quite el límite para resolver un problema de funcionamiento.

## Arquitectura desplegada

| Servicio | Contenido | Volumen |
|---|---|---|
| `softarq` | Imagen del `Dockerfile` (API NestJS + panel compilado), 1 réplica, healthcheck `/health` (`railway.json`) | `/data` (PDF emitidos en `/data/documentos`) |
| `Postgres` | PostgreSQL 18 (plantilla de Railway) | `/var/lib/postgresql/data` |

Variables del servicio `softarq` (valores en Railway, nunca en Git): `API_PUBLIC_URL`, `VITE_API_URL` (origen público, argumento de compilación), `DATABASE_URL` (rol `softarq_app`, host `postgres.railway.internal`), `SOFTARQ_DIR_DOCUMENTOS=/data/documentos`. Las variables de la carga inicial se eliminaron al terminar.

## Operaciones frecuentes (desde la raíz del repositorio, con `railway login` hecho)

| Tarea | Comando |
|---|---|
| Estado y consumo | `railway service list` · `railway usage` · `railway metrics --all` |
| Registros | `railway logs --service softarq` |
| Actualizar el código | confirmar y publicar el commit; `railway up --service softarq --ci` (compila la imagen y despliega; no hay despliegue automático desde GitHub) |
| Reiniciar | `railway redeploy --service softarq -y` |
| Recorrido de verificación | `node scripts/nube/recorrido-nube.mjs https://softarq-production.up.railway.app` (cuentas QA; deja datos `[QA]`) |
| Migraciones | respaldo verificado primero; después `db:migrar:nube` con el rol migrador desde el propio servicio (ver ADR-0025) |

Si hubiera migraciones nuevas, el servicio las aplicaría con `SOFTARQ_OPERACION=carga-inicial` solo en una carga nueva; para una base ya cargada se ejecutan con `db:migrar:nube --respaldo-verificado` dentro de la red privada.

## Respaldo y recuperación del entorno en línea

- Los respaldos se hacen **con pg_dump dentro de la red privada** (el servicio `Postgres` y la imagen de `softarq` incluyen el cliente de PostgreSQL 18). Acceso: registre su propia llave SSH (`railway ssh keys add`) y ejecute `railway ssh --service Postgres -- pg_dump …`; los PDF están en `/data/documentos` del servicio `softarq`.
- Cifre cada respaldo antes de sacarlo del servicio: `respaldo:cifrar-aead` (AES-256-GCM; clave en `SOFTARQ_RESPALDO_CLAVE_AEAD`, guardada aparte) y, como requisito académico, `respaldo:cifrar` (Vigenère). La clave AEAD de la carga inicial está en `_work/secrets/nube-railway.json`.
- **Recuperar** = crear una base nueva y restaurar ahí (nunca sobre la base viva): el mismo mecanismo de la carga inicial (`scripts/nube/operacion-inicial.mjs`: roles, descifrado, `pg_restore`, permisos, revocación de sesiones y comprobación SHA-256 de los PDF).
- Los respaldos que solo residen en el volumen comparten su fallo: descargue una copia cifrada a un medio propio.
- Esta ruta (SSH y restauración desde un respaldo nuevo) **no se ejecutó**; sí se ejecutó la carga inicial completa desde un respaldo cifrado y verificado.

## APK conectada

Perfil EAS `interna`: APK de distribución interna con el JavaScript incluido, sin development client, Metro ni `adb reverse`. La URL sale del entorno `preview` de EAS (`EXPO_PUBLIC_API_URL`) y la compilación se detiene si no es el origen https público. Misma API y misma base que el panel.

```
pnpm --filter @softarq/mobile eas build --platform android --profile interna
```

El enlace de instalación se indica en el [README](../../README.md) cuando la compilación termina.

## Detener o cancelar al terminar la exposición

- **Detener sin perder datos:** `railway down --service softarq` y `railway down --service Postgres` retiran el despliegue; los volúmenes conservan base y documentos (el almacenamiento retenido puede seguir facturándose). Volver a encender: `railway redeploy --service Postgres -y` y `railway up --service softarq --ci`.
- **Eliminar todo:** descargue antes un respaldo cifrado; después `railway delete` (o desde el panel) elimina el proyecto y sus volúmenes. Cancele Hobby desde *Workspace → Billing* si ya no lo necesita.

## Compilación publicada

APK `interna` v0.1.0, compilada el 14/11/2026 en EAS (proyecto `softarq-demo`, firma existente): [página](https://expo.dev/accounts/raulherrera09/projects/softarq-demo/builds/670bc4bc-1f71-4c2b-a657-537bc84337e7), SHA-256 del archivo `6f6eef36…35c8` (32,3 MB). Comprobado sobre el archivo: incluye el JavaScript, apunta a `https://softarq-production.up.railway.app`, no es depurable y no contiene el lanzador ni el menú de desarrollo. **No se instaló en un teléfono en esta sesión.** Si cambia el dominio, actualice `EXPO_PUBLIC_API_URL` en EAS (`env:set` en `preview`) y vuelva a compilar.

> **Aviso de plazo:** la CLI de Railway avisa de que `railway.json` (configuración como código) se declara obsoleta y deja de leerse el 01/12/2026. Antes de esa fecha, migrar con `railway config migrate` o fijar en el panel el healthcheck `/health`, la réplica única y el Dockerfile.
