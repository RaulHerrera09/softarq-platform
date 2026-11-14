# ADR-0025 — Despliegue en línea (Railway): un servicio, PostgreSQL privado y presupuesto

- **Fecha:** 14/11/2026
- **Estado:** **preparación completada; despliegue NO realizado** (pendiente de una decisión del propietario sobre el presupuesto, ver §2).
- **Ámbito:** `apps/api` (`config/entorno.ts`, `http/cookies.ts`, `http/crear-aplicacion.ts`, `main.ts`, scripts `db/*-nube.mjs` y `respaldo/aead*.mjs`), `apps/web/src/config/url-api.ts`, `apps/mobile` (`eas.json`, `app.config.ts`), `Dockerfile`, `railway.json` y [`docs/operacion/despliegue-railway.md`](../operacion/despliegue-railway.md).
- **Relacionada con:** [ADR-0005](0005-api-http-local.md), [ADR-0007](0007-autenticacion-sesiones.md), [ADR-0010](0010-emision-pdf-anulacion-descarte.md) (documentos persistentes), [ADR-0012](0012-respaldo-y-restauracion-local.md), [ADR-0020](0020-app-movil-expo-conexion-y-sesion-movil.md), [ADR-0024](0024-respaldo-cifrado-vigenere.md).

## 1. Arquitectura elegida (la más económica que mantiene PostgreSQL y el motor actual)

Dos servicios en un solo entorno, una réplica, sin despliegues de PR:

1. **`softarq`** — una imagen (Dockerfile) donde la API NestJS sirve también el panel web compilado, en el **mismo origen https**. Sin Vite en línea. Volumen persistente para los PDF emitidos.
2. **`postgres`** — PostgreSQL 18 independiente, solo por red privada (`*.railway.internal`), con volumen. Sin proxy TCP público (evita egreso y superficie de ataque).

La app móvil (APK) no es un servicio: se compila en EAS y llama a la misma API por HTTPS. Los servicios `mobile`, `api` y `web` que el asistente de Railway detectó automáticamente **no deben crearse**: la APK no se aloja en Railway y la web ya viaja dentro de la imagen de la API.

## 2. Presupuesto: incompatibilidad documentada

Según la documentación vigente de Railway (leída el 14/11/2026): Hobby incluye 5 USD de uso; el excedente se factura; el **hard limit mínimo documentado es de 10 USD** (al alcanzarlo se apagan los servicios). Los avisos por correo (límite blando) no detienen nada. Por tanto **no existe, según la documentación, un corte efectivo a 5 USD**, y no se configura uno de 10 USD porque excede lo autorizado. No se pudo comprobar el panel de la cuenta (la extensión de navegador no estaba conectada y no hay CLI de Railway instalada); el propietario puede verificar en *Workspace → Usage* si su cuenta admite un límite menor.

Estimación de consumo con las tarifas publicadas (RAM 10 USD/GB·mes, CPU 20 USD/vCPU·mes, volumen 0,15 USD/GB·mes, egreso 0,05 USD/GB), **no garantizada**:

| Escenario | Cálculo | Estimado |
|---|---|---|
| Continuo 24/7 | API ≈ 0,2 GB y 0,02 vCPU; PostgreSQL ≈ 0,2 GB y 0,02 vCPU; 2 volúmenes de 1 GB | ≈ 4,2–7 USD/mes (en el límite o por encima de lo incluido) |
| Presentación (encendido unas horas, servicios detenidos el resto) | cómputo casi nulo + volúmenes | ≈ 0,3–0,5 USD/mes (si el volumen de un servicio detenido sigue cobrando; la documentación no lo precisa) |

Serverless (dormir tras 5–10 min sin tráfico saliente) reduciría el caso continuo, pero las conexiones abiertas a la base lo impiden: exigiría cerrar el pool de conexiones al quedar inactivo y comprobar en un despliegue real que PostgreSQL y la API duermen y despiertan correctamente. No se ha comprobado y no se añaden monitores que mantengan despierto el sistema.

## 3. Decisiones de la preparación (hechas y verificadas en local)

- **Despliegue `local` o `nube`** (`SOFTARQ_DESPLIEGUE`), ambos con validación estricta al arrancar: la nube no desactiva protecciones locales, cambia cuáles aplican. `nube` exige `NODE_ENV=production`, `0.0.0.0:PORT`, base solo en `*.railway.internal`, rol `softarq_app` (nunca `postgres` ni el migrador), un único origen público https (`API_PUBLIC_URL`), sin `API_CORS_ORIGINS`, cookie **`Secure`** (con `HttpOnly`, `SameSite=Strict`, `Path=/api/v1`), **HSTS**, `trust proxy = 1` y la comprobación de `Origin` solo contra el origen público. En local nada cambia (`NODE_ENV=production` sigue rechazado).
- **Panel en el mismo origen:** `SOFTARQ_DIR_WEB`; recursos con hash inmutables e `index.html` sin caché. `VITE_API_URL` admite el origen https público (dominio, sin puerto ni ruta); localhost sigue exigiendo http con puerto.
- **Healthcheck** `GET /health`; apagado ordenado con SIGTERM (ganchos de Nest); una réplica.
- **Base de datos:** roles `softarq_migrator` y `softarq_app` con `db:aprovisionar:nube` (una vez, con el superusuario, contraseñas ≥ 32 caracteres nuevas) y migraciones **controladas** con `db:migrar:nube --respaldo-verificado`, nunca al arrancar.
- **Documentos:** `SOFTARQ_DIR_DOCUMENTOS` apunta al punto de montaje de un volumen persistente, no al disco efímero.
- **Respaldos en línea:** cifrado autenticado **AES-256-GCM por bloques de 1 MiB** (`respaldo:cifrar-aead` / `respaldo:descifrar-aead`), con clave propia (`SOFTARQ_RESPALDO_CLAVE_AEAD`) distinta de la de Vigenère y guardada en el gestor de secretos; detecta alteración, truncado, reordenación y clave incorrecta (12 pruebas). Vigenère (ADR-0024) se conserva como requisito académico. Los scripts de PostgreSQL resuelven ejecutables en Linux (`SOFTARQ_PG_BIN`, por omisión `/usr/lib/postgresql/18/bin`).
- **APK:** perfil EAS `interna` (distribución interna, JavaScript incluido, sin development client). La compilación se detiene si `EXPO_PUBLIC_API_URL` no es el origen https público; la URL se fija con `eas env` (entorno `preview`).

## 4. Qué falta (solo tras la decisión del propietario)

Crear el proyecto en Railway con los dos servicios, aprovisionar roles, trasladar un respaldo verificado a una copia independiente, revocar sesiones trasladadas, verificar el recorrido completo con cuentas QA y compilar la APK. La imagen Docker **no se pudo construir en esta laptop** (sin Docker): la primera construcción en Railway es la primera prueba real de la imagen; los pasos de instalación y compilación se comprobaron por separado.

## Pruebas (14/11/2026)

API: 573/573 unitarias (entorno 26, AEAD 12) y tipos limpios; web: pruebas de configuración 15/15 y tipos limpios; modo `nube` local contra la base local con panel compilado (https simulado con cabeceras de proxy): `/health` 200, panel servido con HSTS, cookie `Secure`, inicio de sesión solo desde el origen público (origen ajeno y origen local → 403), sesión restaurada y ruta protegida 200.
