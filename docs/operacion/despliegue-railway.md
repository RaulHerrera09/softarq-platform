# Despliegue en línea con Railway

Decisión y presupuesto: [ADR-0025](../adr/0025-despliegue-en-linea-railway.md). **Estado: desplegado y verificado (14/11/2026).**

- **Panel y API (mismo origen https):** https://softarq-production.up.railway.app
- **Proyecto:** `upbeat-alignment`, entorno `production`, workspace Hobby. Dos servicios: `softarq` (API + panel, volumen en `/data`) y `Postgres` (PostgreSQL 18, volumen propio, solo red privada, sin proxy TCP público).
- Los datos son DEMO. Las contraseñas de la nube no están en el repositorio: viven en `_work/secrets/` de la laptop del propietario (`nube-railway.json` para las técnicas y `nube-presentacion.json` para las temporales de las cuentas de presentación).

## Control del gasto (workspace)

Ciclo de facturación: **14/11/2026 – 14/12/2026** (renovación el 14/12/2026). Límites guardados y verificados con `railway usage limit status`:

| Límite | Valor | Efecto |
|---|---|---|
| Alerta por correo (blanda) | 5 USD | Solo avisa |
| Hard limit del workspace | 10 USD (autorización del propietario) | Apaga todas las cargas al alcanzarlo |
| Railway Agent | 0 USD (bloqueado) | No se usa |

El límite cubre cómputo, almacenamiento y salida de red. **No es una garantía de la factura final**: no incluye la suscripción Hobby de 5 USD ni impuestos, y un servicio apagado por el límite deja los volúmenes con sus datos. Consulte `railway usage`. No suba ni quite el límite para resolver un problema de funcionamiento.

## Arquitectura desplegada

| Servicio | Contenido | Volumen |
|---|---|---|
| `softarq` | Imagen del `Dockerfile` (API NestJS + panel compilado), 1 réplica, healthcheck `/health` | `/data` (PDF emitidos en `/data/documentos`) |
| `Postgres` | PostgreSQL 18 (plantilla de Railway) | `/var/lib/postgresql/data` |

Variables del servicio `softarq` (valores en Railway, nunca en Git): `API_PUBLIC_URL`, `VITE_API_URL` (origen público, argumento de compilación), `DATABASE_URL` (rol `softarq_app`, host `postgres.railway.internal`), `SOFTARQ_DIR_DOCUMENTOS=/data/documentos`. Las variables de las operaciones puntuales se eliminan al terminar.

**Configuración como código:** el constructor (Dockerfile), el healthcheck `/health` (300 s), la réplica única y el montaje `/data` están en [`.railway/railway.ts`](../../.railway/railway.ts) (mecanismo vigente; reemplaza a `railway.json`, obsoleto). Las variables quedan fuera (`unmanaged`). Revise y aplique con la CLI desde PowerShell (el SDK necesita el ejecutable real: `$env:_ = "<ruta de railway.exe>"`): `railway config plan` y `railway config apply --yes`.

## Operaciones frecuentes (desde la raíz del repositorio, con `railway login` hecho)

| Tarea | Comando |
|---|---|
| Estado y consumo | `railway service list` · `railway usage` · `railway metrics --all` |
| Registros | `railway logs --service softarq` |
| Actualizar el código | publicar el commit y `railway up --service softarq --ci` (compila la imagen y despliega; no hay despliegue automático desde GitHub) |
| Reiniciar | `railway redeploy --service softarq -y` |
| Recorrido de verificación | `node scripts/nube/recorrido-nube.mjs https://softarq-production.up.railway.app` (cuentas QA; deja datos `[QA]`) |
| Historial y vista de presentación | `node scripts/nube/verificar-historial.mjs` |
| Cuentas de presentación | `node scripts/nube/preparar-cuentas.mjs` (idempotente) |
| Ejemplos y depuración | `node scripts/nube/crear-ejemplos.mjs` · `node scripts/nube/limpiar-demo.mjs [--ejecutar]` |

Las operaciones que necesitan la base (carga inicial, respaldo, comprobación de credenciales) se ejecutan **dentro del servicio** con `SOFTARQ_OPERACION` (`scripts/nube/arranque.mjs`), sin abrir la base al exterior ni usar SSH.

## Respaldo y recuperación del entorno en línea (probado)

Procedimiento: `node scripts/nube/respaldar-nube.mjs`.

1. Fija variables temporales (operación `respaldo`, contraseña del rol dueño y clave AES-256-GCM, desde `_work/secrets`; no se muestran) y reinicia el servicio.
2. El servicio hace el respaldo coherente (instantánea + `pg_dump` + PDF con SHA-256), lo verifica, lo cifra con **AES-256-GCM** por bloques de 1 MiB y publica los bloques, con su SHA-256, en su **registro privado**.
3. La laptop lee el registro, elimina las variables temporales, reinicia el servicio en modo normal, reúne el respaldo (SHA-256 por bloque y archivo), lo descifra y lo verifica (manifiesto, volcado legible y cada PDF).
4. Queda en `respaldos\softarq_nube\<ID>` (cifrado) y `_work\respaldo-descifrado-aead\<ID>` (verificado).

**Restaurar** solo en una base aislada: `respaldo:restaurar <carpeta descifrada>` (destino `softarq_restauracion`, nunca desarrollo ni la base viva). Probado con el respaldo `softarq_dev-20261114T202805Z-ae1606`: 37 tablas iguales al manifiesto, COT-2026-00056 presente y documentos sin ausentes ni dañados. La recuperación real sobre la base viva sería una carga como la inicial (`scripts/nube/operacion-inicial.mjs`) en una base nueva. Vigenère (académico) sigue disponible (`respaldo:cifrar`). El canal por el registro sirve para el tamaño de esta demostración (~1 MB); no sustituye a un almacenamiento externo.

## Rotación de la credencial del superusuario

La credencial de `postgres` solo la usan las variables del servicio `Postgres`; la aplicación usa `softarq_app` y los respaldos `softarq_migrator`, ambos con contraseñas propias. Se rotó con **Regenerate** en el panel de Railway (actualiza PostgreSQL y las variables). Comprobado dentro del servicio (`comprobar-credenciales`): la nueva autentica, la anterior ya no, y `softarq_app` conserva su lectura sin superusuario ni DDL.

## APK conectada

Perfil EAS `interna`: APK de distribución interna con el JavaScript incluido, sin development client, Metro ni `adb reverse`. La URL sale del entorno `preview` de EAS (`EXPO_PUBLIC_API_URL`) y la compilación se detiene si no es el origen https público. Misma API y misma base que el panel. Compilación vigente (14/11/2026, v0.1.0): [página](https://expo.dev/accounts/raulherrera09/projects/softarq-demo/builds/670bc4bc-1f71-4c2b-a657-537bc84337e7), SHA-256 `6f6eef36…35c8`. Los cambios del panel y de los datos no requieren recompilarla; sí un cambio en la app o en la URL.

```
pnpm --filter @softarq/mobile eas build --platform android --profile interna
```

## Detener, eliminar o cancelar (tres cosas distintas)

| Acción | Qué hace | Cómo | Qué conserva |
|---|---|---|---|
| **Detener los servicios** | Deja de ejecutar la API y la base; el consumo de cómputo baja a casi cero | `railway down --service softarq` y `railway down --service Postgres` (volver a encender: `railway redeploy --service Postgres -y` y `railway up --service softarq --ci`) | Los volúmenes con la base y los PDF (el almacenamiento retenido puede seguir facturándose) y la suscripción Hobby |
| **Eliminar el proyecto y sus datos** | Borra los servicios, los volúmenes y todo el contenido | Descargue antes un respaldo cifrado (`respaldar-nube.mjs`); después `railway delete` o desde el panel | Solo lo que se descargó; la suscripción Hobby sigue activa |
| **Cancelar la suscripción Hobby** | Termina el plan de pago del workspace | Panel: *Workspace → Billing* (después de eliminar o detener todo lo que no deba quedar) | Nada del proyecto, si ya se eliminó |

Nada de esto se ejecutó. El consumo del ciclo se consulta con `railway usage`.
