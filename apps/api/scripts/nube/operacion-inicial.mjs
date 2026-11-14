/**
 * Carga inicial del entorno en línea (ADR-0025), una sola vez y de forma idempotente. Se ejecuta DENTRO del servicio
 * (red privada) antes de arrancar la API, con SOFTARQ_OPERACION=carga-inicial. Pasos, deteniéndose en el primer fallo:
 *  1. Roles softarq_migrator y softarq_app (aprovisionar-nube.mjs).
 *  2. Descifrado AES-256-GCM del respaldo y verificación (manifiesto, volcado y PDF por SHA-256).
 *  3. pg_restore en una base vacía, con los objetos a nombre de softarq_migrator.
 *  4. Migraciones pendientes y permisos mínimos de softarq_app.
 *  5. Todas las sesiones trasladadas se revocan; las cuentas listadas en cuentas-nube.json reciben credenciales nuevas
 *     (solo su hash, calculado fuera) o se desactivan.
 *  6. Documentos copiados al volumen y comprobados con su SHA-256.
 * Marca en el volumen: no se repite. Nunca imprime contraseñas, URL ni claves.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PG_BIN, EXT } from "../respaldo/comun.mjs";
import { cargarClaveAead } from "../respaldo/aead.mjs";
import { descifrarRespaldoAead } from "../respaldo/cifrar-aead.mjs";
import { migrarYOtorgarPermisos } from "../db/prisma-seguro.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (t) => console.log(`[carga-inicial] ${t}`);
const requerida = (n) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}.`);
  return v;
};
const sha = (ruta) =>
  new Promise((ok, mal) => {
    const h = createHash("sha256");
    createReadStream(ruta).on("data", (d) => h.update(d)).on("error", mal).on("end", () => ok(h.digest("hex")));
  });

const dirDocs = requerida("SOFTARQ_DIR_DOCUMENTOS");
const carga = process.env.SOFTARQ_CARGA_DIR ?? join(RAIZ, "carga-nube");
const idCarga = JSON.parse(readFileSync(join(carga, "carga.json"), "utf8")).id;
const marca = join(dirname(dirDocs), `.carga-${idCarga}.hecha`);

if (existsSync(marca)) {
  log(`la carga ${idCarga} ya se aplicó; no se repite.`);
} else {
  const admin = new URL(requerida("ADMIN_DATABASE_URL"));
  const base = decodeURIComponent(admin.pathname.slice(1));
  const clave = cargarClaveAead();

  log("1/6 roles");
  const r1 = spawnSync(process.execPath, [join(RAIZ, "scripts", "db", "aprovisionar-nube.mjs")], { stdio: "inherit", env: process.env });
  if (r1.status !== 0) throw new Error("El aprovisionamiento de roles falló.");

  log("2/6 descifrar y verificar el respaldo");
  const dirRespaldo = join(carga, idCarga);
  rmSync("/tmp/respaldo-descifrado", { recursive: true, force: true }); // restos de un intento anterior
  const { ruta } = await descifrarRespaldoAead(dirRespaldo, { clave, destino: "/tmp/respaldo-descifrado" });
  const manifiesto = JSON.parse(readFileSync(join(ruta, "manifiesto.json"), "utf8"));

  const marcaRestaurada = join(dirname(dirDocs), `.carga-${idCarga}.restaurada`);
  if (existsSync(marcaRestaurada) || process.env.SOFTARQ_CARGA_RESTAURADA === "1") {
    log("3/6 la base ya se restauró en un intento anterior; se continúa");
  } else {
    log("3/6 restaurar en la base vacía");
    const cAdmin = new pg.Client({ connectionString: admin.toString() });
    await cAdmin.connect();
    const { rows: [o] } = await cAdmin.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public'");
    await cAdmin.end();
    if (o.n !== 0) throw new Error("La base de destino no está vacía; no se restaura sobre datos existentes.");
    const r3 = spawnSync(join(PG_BIN, `pg_restore${EXT}`), ["--no-owner", "--role=softarq_migrator", "--single-transaction", "--exit-on-error", "-d", admin.toString(), join(ruta, "base.dump")], { stdio: "inherit" });
    if (r3.status !== 0) throw new Error("pg_restore falló.");
    writeFileSync(marcaRestaurada, `${new Date().toISOString()}
`);
  }

  log("4/6 migraciones pendientes y permisos");
  const mig = new URL(admin.toString());
  mig.username = "softarq_migrator";
  mig.password = requerida("SOFTARQ_MIGRATOR_PASSWORD");
  process.env.MIGRATION_DATABASE_URL = mig.toString();
  migrarYOtorgarPermisos();

  log("5/6 sesiones y cuentas");
  const c = new pg.Client({ connectionString: mig.toString() });
  await c.connect();
  const rev = await c.query("UPDATE sesion SET revocada_en = now(), motivo_revocacion = 'RESTAURACION' WHERE revocada_en IS NULL");
  log(`sesiones trasladadas revocadas: ${rev.rowCount}`);
  const cuentas = JSON.parse(readFileSync(join(carga, "cuentas-nube.json"), "utf8"));
  for (const a of cuentas) {
    if (a.accion === "credencial") {
      const x = await c.query("UPDATE usuario SET hash_contrasena = $1, contrasena_cambiada_en = now(), contrasena_temporal_expira_en = NULL, activo = true WHERE correo = $2", [a.hash, a.correo]);
      if (x.rowCount !== 1) throw new Error("Una cuenta de la lista no existe.");
    } else if (a.accion === "desactivar") {
      await c.query("UPDATE usuario SET activo = false WHERE correo = $1", [a.correo]);
    }
  }
  log(`cuentas procesadas: ${cuentas.length}`);
  await c.end();

  log("6/6 documentos");
  let n = 0;
  for (const d of manifiesto.documentos.lista) {
    const origen = join(ruta, "documentos", ...d.clave.split("/"));
    const destino = join(dirDocs, ...d.clave.split("/"));
    mkdirSync(dirname(destino), { recursive: true });
    if (!existsSync(destino)) copyFileSync(origen, destino, constants.COPYFILE_EXCL);
    if (statSync(destino).size !== d.bytes || (await sha(destino)) !== d.sha256) throw new Error(`El documento ${d.clave} no coincide con su SHA-256.`);
    n++;
  }
  log(`documentos copiados y comprobados: ${n}`);
  writeFileSync(marca, `${new Date().toISOString()}\n`);
  log(`carga ${idCarga} completa.`);
}
