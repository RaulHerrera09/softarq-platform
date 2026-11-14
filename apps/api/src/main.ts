/**
 * Arranque de la API: `node dist/main.js` (o `pnpm --filter @softarq/api start`).
 * Lee apps/api/.env si existe (o SOFTARQ_ENV_FILE), valida la configuración y escucha en 127.0.0.1 (local)
 * o en 0.0.0.0:PORT detrás del proxy de la plataforma (nube, ADR-0025). Se detiene de forma ordenada con SIGTERM.
 */
import "reflect-metadata";
import { existsSync } from "node:fs";
import { leerConfiguracion } from "./config/entorno.js";
import { crearAplicacion } from "./http/crear-aplicacion.js";

async function principal(): Promise<void> {
  const archivo = process.env["SOFTARQ_ENV_FILE"] ?? ".env";
  if (existsSync(archivo)) process.loadEnvFile(archivo);
  const config = leerConfiguracion(process.env);
  if (!config.dirDocumentos) {
    // Los PDF emitidos son originales persistentes (ADR-0010): sin carpeta no se arranca.
    throw new Error("Falta SOFTARQ_DIR_DOCUMENTOS (carpeta persistente de los PDF emitidos; ver apps/api/.env.example).");
  }
  const app = await crearAplicacion(config);
  await app.listen(config.puerto, config.host);
  console.log(`SoftArq API (DEMO, ${config.despliegue}) escuchando en ${config.host}:${config.puerto} — Ctrl+C o SIGTERM para detener.`);
}

principal().catch((e: unknown) => {
  // Mensaje claro y sin trazas ni valores secretos.
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : "Error de arranque.");
  process.exitCode = 1;
});
