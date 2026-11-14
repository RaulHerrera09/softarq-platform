/**
 * Respaldo del entorno en línea (ADR-0025), ejecutado DENTRO del servicio con SOFTARQ_OPERACION=respaldo antes de arrancar la API.
 * Sin abrir la base al exterior ni usar SSH:
 *  1. Mismo procedimiento coherente de siempre (instantánea REPEATABLE READ + pg_dump + PDF con SHA-256), con el rol dueño
 *     (softarq_migrator, contraseña en SOFTARQ_MIGRATOR_PASSWORD, temporal) sobre la base de DATABASE_URL.
 *  2. Verificación completa del respaldo y cifrado AES-256-GCM (clave en SOFTARQ_RESPALDO_CLAVE_AEAD, temporal).
 *  3. El texto cifrado sale por el registro privado del servicio, en bloques con SHA-256 (líneas «SQB1 …»); en la laptop
 *     `scripts/nube/recuperar-respaldo.mjs` los reúne, comprueba y deja la carpeta cifrada. Nunca se imprime la clave,
 *     una contraseña ni contenido sin cifrar.
 * Pensado para el tamaño de esta demostración (unos pocos MB); no sustituye a un almacenamiento externo de respaldos.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

process.env.SOFTARQ_DIR_TRABAJO ??= "/tmp/softarq-trabajo";
const requerida = (n) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}.`);
  return v;
};
const { crearRespaldo } = await import("../respaldo/respaldar.mjs");
const { exigirRespaldoValido } = await import("../respaldo/verificar.mjs");
const { cifrarRespaldoAead } = await import("../respaldo/cifrar-aead.mjs");
const { cargarClaveAead } = await import("../respaldo/aead.mjs");

const url = new URL(requerida("DATABASE_URL"));
const base = decodeURIComponent(url.pathname.slice(1));
const conexion = { host: url.hostname, puerto: url.port || "5432", usuario: "softarq_migrator", contrasena: requerida("SOFTARQ_MIGRATOR_PASSWORD"), base };
conexion.cadena = `postgresql://softarq_migrator:${encodeURIComponent(conexion.contrasena)}@${conexion.host}:${conexion.puerto}/${base}`;

const log = (t) => console.log(`[respaldo-nube] ${t}`);
log("1/3 respaldo coherente");
const r = await crearRespaldo({ conexion, baseEsperada: base, rolEsperado: "softarq_migrator", dirDocumentos: requerida("SOFTARQ_DIR_DOCUMENTOS"), dirRespaldos: "/tmp/respaldo-nube" });
if (r.estado !== "COMPLETO") throw new Error(`Respaldo incompleto: ${JSON.stringify(r.problemas).slice(0, 300)}`);
log("2/3 verificar y cifrar");
await exigirRespaldoValido(r.ruta);
const c = await cifrarRespaldoAead(r.ruta, { clave: cargarClaveAead(), dirDestino: "/tmp/respaldo-aead" });

log("3/3 publicar el texto cifrado en el registro privado");
const listar = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(d, e.name)) : [join(d, e.name)]));
const archivos = listar(c.ruta).map((f) => ({ ruta: relative(c.ruta, f).split("\\").join("/"), ruta_abs: f }));
const indice = [];
const TROZO = 3 * 1024;
for (const a of archivos) {
  const datos = readFileSync(a.ruta_abs);
  const n = Math.max(1, Math.ceil(datos.length / TROZO));
  indice.push({ ruta: a.ruta, bytes: datos.length, sha256: createHash("sha256").update(datos).digest("hex"), trozos: n });
}
console.log(`SQB1-INDICE ${JSON.stringify({ id: c.id, archivos: indice })}`);
for (const a of archivos) {
  const datos = readFileSync(a.ruta_abs);
  const n = Math.max(1, Math.ceil(datos.length / TROZO));
  for (let i = 0; i < n; i++) {
    const trozo = datos.subarray(i * TROZO, (i + 1) * TROZO);
    console.log(`SQB1 ${Buffer.from(a.ruta).toString("base64url")} ${i + 1}/${n} ${createHash("sha256").update(trozo).digest("hex")} ${trozo.toString("base64")}`);
  }
}
console.log(`SQB1-FIN ${c.id} ${archivos.length}`);
log(`respaldo ${c.id} publicado (${archivos.length} archivos, ${indice.reduce((s, x) => s + x.bytes, 0)} bytes cifrados).`);
void statSync;
