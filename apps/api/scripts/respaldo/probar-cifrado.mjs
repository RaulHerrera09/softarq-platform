#!/usr/bin/env node
/**
 * Prueba completa del respaldo cifrado con Vigenère (ADR-0024): respaldo real → cifrar → verificar
 * sin escribir → descifrar → comparar bytes por SHA-256 → verificar → restaurar SOLO en
 * softarq_restauracion → casos de fallo con copias en _work. No toca softarq_dev ni sus documentos.
 *
 * Uso (desde apps/api):  pnpm respaldo:probar-cifrado     (compila la API antes)
 * Requiere la clave: SOFTARQ_RESPALDO_CLAVE_VIGENERE o la clave local (pnpm respaldo:clave-crear).
 * Informe: _work\evidencias\vigenere-<ID>\informe.txt (sin la clave).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { DIR_WORK, dirDocumentosDesarrollo, sha256Archivo, urlDeRol } from "./comun.mjs";
import { cifrarRespaldo, descifrarRespaldo } from "./cifrar.mjs";
import { crearRespaldo } from "./respaldar.mjs";
import { restaurarRespaldo } from "./restaurar.mjs";
import { verificarRespaldo } from "./verificar.mjs";
import { ARCHIVO_CLAVE_DPAPI, VARIABLE_CLAVE, cargarClave, claveABytes, crearClaveLocal } from "./vigenere.mjs";

const resultados = [];
const registrar = (nombre, ok, detalle = "") => {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};
const archivos = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(dir, e.name)) : [join(dir, e.name)])) : []);
async function huella(dir) {
  const h = {};
  for (const f of archivos(dir)) h[f.slice(dir.length)] = `${statSync(f).size}:${await sha256Archivo(f)}`;
  return h;
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function rechazo(nombre, fn, patron) {
  try {
    await fn();
    registrar(nombre, false, "no falló");
  } catch (e) {
    registrar(nombre, patron.test(String(e.message)), String(e.message).split("\n")[0].slice(0, 120));
  }
}
async function esperarFallo(nombre, promesa, patron) {
  const r = await promesa;
  registrar(nombre, !r.ok && r.errores.some((e) => patron.test(e)), r.errores[0]?.slice(0, 120) ?? "no falló");
}

let picoRss = 0;
const muestreo = setInterval(() => (picoRss = Math.max(picoRss, process.memoryUsage().rss)), 200);

if (!process.env[VARIABLE_CLAVE] && !existsSync(ARCHIVO_CLAVE_DPAPI)) {
  crearClaveLocal();
  console.log("Se creó la clave local (DPAPI); no se muestra.");
}
const clave = cargarClave();
const fraseSecreta = process.env[VARIABLE_CLAVE] ?? null;
registrar("clave cargada sin mostrarla", clave.length >= 16, `${clave.length} bytes`);

const docs = dirDocumentosDesarrollo();
const docsAntes = await huella(docs);

// 1. Respaldo real y su huella (no debe cambiar al cifrar).
const r = await crearRespaldo();
registrar("respaldo real COMPLETO", r.estado === "COMPLETO", r.ruta);
if (r.estado !== "COMPLETO") process.exit(1);
const original = r.ruta;
const huellaOriginal = await huella(original);
const m = r.manifiesto;

// 2. Cifrar.
const c = await cifrarRespaldo(original, { clave });
const total = c.archivos.length;
registrar("respaldo cifrado creado", existsSync(c.ruta), `${total} archivos (volcado + manifiesto + ${m.documentos.total} PDF)`);
registrar("el respaldo original no cambió (nombres, tamaños y SHA-256)", igual(huellaOriginal, await huella(original)));
const volcadoCifrado = readFileSync(join(c.ruta, "base.dump.vig")).subarray(0, 8);
registrar("el volcado cifrado ya no empieza con la firma PGDMP", volcadoCifrado.subarray(0, 5).toString("latin1") !== "PGDMP", "firma del claro: PGDMP");
const pdfCif = c.archivos.find((a) => a.tipo === "DOCUMENTO");
if (pdfCif) registrar("un PDF cifrado ya no empieza con %PDF", readFileSync(join(c.ruta, ...pdfCif.ruta.split("/"))).subarray(0, 4).toString("latin1") !== "%PDF");
const mcTexto = readFileSync(join(c.ruta, "manifiesto-cifrado.json"), "utf8");
registrar("el manifiesto cifrado no contiene la clave", !fraseSecreta || !mcTexto.includes(fraseSecreta));
registrar("no se sobrescribe un respaldo cifrado existente", await cifrarRespaldo(original, { clave }).then(() => false, (e) => /no se sobrescribe/.test(e.message)));

// 3. Verificar sin escribir, descifrar y comparar.
const ver = await descifrarRespaldo(c.ruta, { clave });
registrar("verificación del cifrado sin escribir", ver.ok, `${ver.archivos} archivos`);
const destDes = join(DIR_WORK, "respaldo-descifrado");
const des = await descifrarRespaldo(c.ruta, { clave, destino: destDes });
registrar("descifrado a carpeta nueva", des.ok, des.ruta ?? des.errores.join("; "));
if (!des.ok) process.exit(1);
registrar("bytes recuperados idénticos a los originales (SHA-256 de cada archivo)", igual(huellaOriginal, await huella(des.ruta)));
const vd = await verificarRespaldo(des.ruta);
registrar("respaldo descifrado válido para respaldo:verificar", vd.ok, vd.errores.join("; "));

// 4. Restaurar solo en el destino aislado.
const rest = await restaurarRespaldo(des.ruta, { silencioso: true });
registrar("restauración en softarq_restauracion", rest.destino === "softarq_restauracion", rest.pasos.at(-1));
{
  const mig = urlDeRol("MIGRATION_DATABASE_URL", "softarq_migrator", "softarq_restauracion");
  const cl = new pg.Client({ connectionString: mig.cadena });
  await cl.connect();
  try {
    const dif = [];
    for (const [t, n] of Object.entries(m.conteos)) {
      const x = (await cl.query(`SELECT count(*)::int n FROM public.${cl.escapeIdentifier(t)}`)).rows[0].n;
      if (x !== n) dif.push(`${t}: ${x}≠${n}`);
    }
    registrar("conteos del destino iguales al manifiesto", dif.length === 0, dif.join("; ") || `${Object.keys(m.conteos).length} tablas`);
  } finally {
    await cl.end();
  }
}

// 5. Fallos con copias en _work (nunca el respaldo cifrado real).
const base = join(DIR_WORK, "pruebas", "vigenere-fallos");
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
const copia = (nombre) => {
  const d = join(base, nombre, c.id);
  cpSync(c.ruta, d, { recursive: true });
  return d;
};
await esperarFallo("clave incorrecta se detecta (cifrado íntegro, claro distinto)", descifrarRespaldo(c.ruta, { clave: claveABytes("clave-incorrecta-ficticia-000") }), /clave incorrecta/);
{
  const d = copia("truncado");
  const f = join(d, "base.dump.vig");
  writeFileSync(f, readFileSync(f).subarray(0, statSync(f).size - 1));
  await esperarFallo("archivo truncado se detecta", descifrarRespaldo(d, { clave }), /truncado/);
}
{
  const d = copia("alterado");
  const f = join(d, "base.dump.vig");
  const b = readFileSync(f);
  b[Math.floor(b.length / 2)] ^= 1;
  writeFileSync(f, b);
  await esperarFallo("archivo alterado se detecta", descifrarRespaldo(d, { clave }), /alterado/);
}
{
  const d = copia("alterado-pdf");
  const f = join(d, ...pdfCif.ruta.split("/"));
  const b = readFileSync(f);
  b[10] ^= 1;
  writeFileSync(f, b);
  await esperarFallo("PDF cifrado alterado se detecta", descifrarRespaldo(d, { clave }), /alterado/);
}
{
  const d = copia("sin-archivo");
  rmSync(join(d, "manifiesto.json.vig"));
  await esperarFallo("archivo cifrado ausente se detecta", descifrarRespaldo(d, { clave }), /Falta/);
}
await rechazo("ausencia de clave se informa", async () => cargarClave({ ruta: join(base, "no-hay-clave.dpapi"), entorno: {} }), /No hay clave/);
await rechazo("clave demasiado corta se rechaza", async () => claveABytes("corta"), /al menos 16 bytes/);
{
  const dd = join(base, "des-fallido");
  await descifrarRespaldo(c.ruta, { clave: claveABytes("clave-incorrecta-ficticia-000"), destino: dd });
  registrar("con clave incorrecta no queda carpeta descifrada", !existsSync(join(dd, c.id)) && !existsSync(join(dd, `${c.id}.en-curso`)));
}

// 6. Desarrollo intacto y memoria.
registrar("documentos de desarrollo intactos", igual(docsAntes, await huella(docs)));
clearInterval(muestreo);
picoRss = Math.max(picoRss, process.memoryUsage().rss);
registrar("memoria del proceso razonable (pico RSS < 400 MiB)", picoRss < 400 * 1024 * 1024, `${Math.round(picoRss / 1048576)} MiB; volcado de ${m.base.bytes} bytes`);

const fallos = resultados.filter((x) => !x.ok);
const dirEv = join(DIR_WORK, "evidencias", `vigenere-${c.id}`);
mkdirSync(dirEv, { recursive: true });
writeFileSync(
  join(dirEv, "informe.txt"),
  [`Prueba de respaldo cifrado Vigenère — ${new Date().toISOString()}`, `Respaldo: ${c.id}`, `Cifrado: ${c.ruta}`, `Descifrado de prueba: ${des.ruta}`, "", ...resultados.map((x) => `${x.ok ? "OK  " : "FALLA"} ${x.nombre}${x.detalle ? ` — ${x.detalle}` : ""}`), "", `${resultados.length - fallos.length}/${resultados.length} comprobaciones correctas`, ""].join("\n"),
);
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones correctas. Informe: ${dirEv}`);
process.exitCode = fallos.length ? 1 : 0;
