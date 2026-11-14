#!/usr/bin/env node
/**
 * Respaldo con cifrado autenticado AES-256-GCM (ADR-0025), complementario a Vigenère (ADR-0024).
 *
 *   pnpm respaldo:aead-clave                         → imprime una clave nueva (guárdela en el gestor de secretos)
 *   pnpm respaldo:cifrar-aead <carpeta respaldo>     → <respaldos>/softarq_dev_aead/<ID>/ (.sqa + manifiesto-aead.json)
 *   pnpm respaldo:descifrar-aead <carpeta> [--destino <carpeta>]  → respaldo normal, verificado por SHA-256
 * La clave SOLO sale de SOFTARQ_RESPALDO_CLAVE_AEAD; nunca se guarda con el respaldo ni se imprime al cifrar.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DIR_RESPALDOS_POR_OMISION, DIR_WORK, ErrorRespaldo, PATRON_CLAVE, PATRON_ID, escribirJson } from "./comun.mjs";
import { cargarClaveAead, cifrarArchivoAead, descifrarArchivoAead, generarClaveAead } from "./aead.mjs";
import { verificarRespaldo } from "./verificar.mjs";

export const FORMATO_AEAD = "softarq-respaldo-aead/1";
export const DIR_AEAD_POR_OMISION = join(DIR_RESPALDOS_POR_OMISION, "..", "softarq_dev_aead");
export const DIR_DESCIFRADOS_AEAD = join(DIR_WORK, "respaldo-descifrado-aead");
const SUFIJO = ".sqa";
const permitida = (r) => r === "base.dump" || r === "manifiesto.json" || (r.startsWith("documentos/") && PATRON_CLAVE.test(r.slice(11)));

export async function cifrarRespaldoAead(carpeta, { clave, dirDestino = DIR_AEAD_POR_OMISION } = {}) {
  const v = await verificarRespaldo(carpeta);
  if (!v.ok) throw new ErrorRespaldo(`El respaldo de origen no es válido; no se cifra:\n  - ${v.errores.join("\n  - ")}`);
  const m = v.manifiesto;
  const final = join(dirDestino, m.id);
  const enCurso = `${final}.en-curso`;
  for (const r of [final, enCurso]) if (existsSync(r)) throw new ErrorRespaldo(`Ya existe ${r}; no se sobrescribe.`);
  mkdirSync(dirDestino, { recursive: true });
  mkdirSync(enCurso);
  try {
    const rutas = ["base.dump", "manifiesto.json", ...m.documentos.lista.map((d) => `documentos/${d.clave}`)];
    const archivos = [];
    for (const r of rutas) {
      const bytesCifrados = await cifrarArchivoAead(join(carpeta, ...r.split("/")), join(enCurso, ...(r + SUFIJO).split("/")), clave);
      archivos.push({ ruta: r + SUFIJO, bytesCifrados });
    }
    escribirJson(join(enCurso, "manifiesto-aead.json"), { formato: FORMATO_AEAD, id: m.id, creadoEn: new Date().toISOString(), algoritmo: "AES-256-GCM por bloques de 1 MiB (SQA1)", archivos });
    renameSync(enCurso, final);
    return { id: m.id, ruta: final, archivos: archivos.length };
  } catch (e) {
    rmSync(enCurso, { recursive: true, force: true });
    throw e;
  }
}

/** Descifra a un respaldo normal (autenticación AEAD por bloque) y lo verifica con `verificarRespaldo`. */
export async function descifrarRespaldoAead(carpeta, { clave, destino = DIR_DESCIFRADOS_AEAD } = {}) {
  const ruta = join(carpeta, "manifiesto-aead.json");
  if (!existsSync(ruta)) throw new ErrorRespaldo("No hay manifiesto-aead.json.");
  const mc = JSON.parse(readFileSync(ruta, "utf8"));
  if (mc.formato !== FORMATO_AEAD || !PATRON_ID.test(mc.id) || basename(carpeta) !== mc.id) throw new ErrorRespaldo("Manifiesto AEAD inválido.");
  const final = join(destino, mc.id);
  const enCurso = `${final}.en-curso`;
  for (const r of [final, enCurso]) if (existsSync(r)) throw new ErrorRespaldo(`Ya existe ${r}; no se sobrescribe.`);
  mkdirSync(destino, { recursive: true });
  mkdirSync(enCurso);
  try {
    for (const a of mc.archivos) {
      if (typeof a.ruta !== "string" || !a.ruta.endsWith(SUFIJO) || !permitida(a.ruta.slice(0, -SUFIJO.length))) throw new ErrorRespaldo(`Ruta no permitida: ${a.ruta}.`);
      await descifrarArchivoAead(join(carpeta, ...a.ruta.split("/")), join(enCurso, ...a.ruta.slice(0, -SUFIJO.length).split("/")), clave);
    }
    renameSync(enCurso, final);
  } catch (e) {
    rmSync(enCurso, { recursive: true, force: true });
    throw e;
  }
  const v = await verificarRespaldo(final);
  if (!v.ok) throw new ErrorRespaldo(`Descifrado sin errores de autenticación, pero el respaldo no verifica:\n  - ${v.errores.join("\n  - ")}`);
  return { id: mc.id, ruta: final };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [orden, carpeta, ...resto] = process.argv.slice(2);
  try {
    if (orden === "clave") console.log(generarClaveAead());
    else if (orden === "cifrar" && carpeta) {
      const r = await cifrarRespaldoAead(carpeta, { clave: cargarClaveAead() });
      console.log(`Respaldo cifrado (AES-256-GCM): ${r.ruta} · ${r.archivos} archivos.`);
    } else if (orden === "descifrar" && carpeta) {
      const i = resto.indexOf("--destino");
      const r = await descifrarRespaldoAead(carpeta, { clave: cargarClaveAead(), destino: i >= 0 ? resto[i + 1] : undefined });
      console.log(`Descifrado y verificado: ${r.ruta}`);
    } else throw new ErrorRespaldo("Uso: cifrar-aead.mjs clave | cifrar <carpeta> | descifrar <carpeta> [--destino <carpeta>]");
  } catch (e) {
    console.error(`Detenido: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
