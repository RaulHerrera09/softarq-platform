#!/usr/bin/env node
/**
 * Migraciones controladas del entorno en línea (ADR-0025). Aplica `prisma migrate deploy` y los permisos
 * de softarq_app con el rol migrador. Nunca reinicia ni borra datos y NO se ejecuta al arrancar la API.
 *
 * Exige confirmar que ya existe un respaldo verificado (`--respaldo-verificado`): en la nube el respaldo
 * lo hace `respaldo:crear-nube`; aquí no se puede saltar la confirmación.
 *
 * Uso (con MIGRATION_DATABASE_URL del rol softarq_migrator en el entorno, p. ej. `railway run`):
 *   node scripts/db/migrar-nube.mjs --respaldo-verificado
 */
import { migrarYOtorgarPermisos } from "./prisma-seguro.mjs";

if (process.env.SOFTARQ_DESPLIEGUE !== "nube") {
  console.error("Este comando es solo para el entorno en línea (SOFTARQ_DESPLIEGUE=nube). En local use db:migrar.");
  process.exit(1);
}
const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !URL.canParse(url)) {
  console.error("Falta MIGRATION_DATABASE_URL.");
  process.exit(1);
}
const u = new URL(url);
if (decodeURIComponent(u.username) !== "softarq_migrator") {
  console.error("MIGRATION_DATABASE_URL debe usar el rol softarq_migrator.");
  process.exit(1);
}
if (!process.argv.includes("--respaldo-verificado")) {
  console.error("Detenido: confirme con --respaldo-verificado que existe un respaldo verificado previo a la migración.");
  process.exit(1);
}
console.log(`Migrando ${decodeURIComponent(u.pathname.slice(1))} en ${u.hostname} con el rol migrador...`);
migrarYOtorgarPermisos();
console.log("Migraciones y permisos aplicados.");
