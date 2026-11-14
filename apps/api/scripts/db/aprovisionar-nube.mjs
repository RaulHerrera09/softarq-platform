#!/usr/bin/env node
/**
 * Aprovisiona los roles del entorno en línea (ADR-0025), una sola vez y de forma idempotente, con el
 * superusuario del PostgreSQL de la plataforma. Crea softarq_migrator (propietario del esquema) y
 * softarq_app (sin DDL), ambos sin privilegios especiales, y deja la base solo para esos roles.
 *
 * Entorno: ADMIN_DATABASE_URL (superusuario), SOFTARQ_MIGRATOR_PASSWORD y SOFTARQ_APP_PASSWORD (≥ 32
 * caracteres; generadas aparte, nunca en Git). No imprime contraseñas ni URL.
 */
import pg from "pg";

const requerida = (n) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}.`);
  return v;
};
const admin = requerida("ADMIN_DATABASE_URL");
const claveMigrador = requerida("SOFTARQ_MIGRATOR_PASSWORD");
const claveApp = requerida("SOFTARQ_APP_PASSWORD");
if (claveMigrador.length < 32 || claveApp.length < 32) throw new Error("Las contraseñas de los roles deben tener al menos 32 caracteres.");
if (claveMigrador === claveApp) throw new Error("Las contraseñas de los dos roles deben ser distintas.");

const cliente = new pg.Client({ connectionString: admin, connectionTimeoutMillis: 15_000 });
await cliente.connect();
try {
  const { rows: [{ base }] } = await cliente.query("SELECT current_database() AS base");
  const atributos = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS";
  for (const [rol, clave] of [["softarq_migrator", claveMigrador], ["softarq_app", claveApp]]) {
    const { rowCount } = await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [rol]);
    const lit = (await cliente.query("SELECT quote_literal($1) AS v", [clave])).rows[0].v;
    await cliente.query(`${rowCount ? "ALTER" : "CREATE"} ROLE ${rol} ${atributos} PASSWORD ${lit}`);
  }
  const b = cliente.escapeIdentifier(base);
  await cliente.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${b} FROM PUBLIC`);
  await cliente.query(`GRANT CONNECT ON DATABASE ${b} TO softarq_app`);
  await cliente.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${b} TO softarq_migrator`);
  await cliente.query("ALTER SCHEMA public OWNER TO softarq_migrator");
  await cliente.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await cliente.query("GRANT USAGE ON SCHEMA public TO softarq_app");
  console.log(`Roles softarq_migrator y softarq_app listos en la base «${base}».`);
} finally {
  await cliente.end();
}
