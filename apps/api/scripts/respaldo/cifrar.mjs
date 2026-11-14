#!/usr/bin/env node
/**
 * Respaldo cifrado con Vigenère de bytes (requisito académico; ADR-0024).
 *
 * Uso (desde apps/api):
 *   pnpm respaldo:cifrar <carpeta de un respaldo COMPLETO>            → <respaldos>/softarq_dev_vigenere/<ID>/
 *   pnpm respaldo:verificar-cifrado <carpeta cifrada>                 → comprueba sin escribir nada
 *   pnpm respaldo:descifrar <carpeta cifrada> [--destino <carpeta>]   → respaldo normal en _work\respaldo-descifrado\<ID>
 *   pnpm respaldo:clave-crear | respaldo:clave-mostrar --confirmar
 *
 * El respaldo original NO se modifica ni se mueve. El respaldo cifrado contiene el volcado, los
 * PDF y el manifiesto original, cada uno cifrado; `manifiesto-cifrado.json` (en claro) lleva el
 * SHA-256 del texto cifrado y del texto claro de cada archivo, pero nunca la clave.
 *
 * Distinción al fallar (sin mostrar secretos):
 *   - el SHA-256 del texto cifrado no coincide → archivo alterado, truncado o dañado;
 *   - el cifrado coincide pero el claro no → clave incorrecta.
 * Los SHA-256 detectan cambios; no son autenticación criptográfica (ver ADR-0024).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DIR_RESPALDOS_POR_OMISION,
  DIR_WORK,
  ErrorRespaldo,
  PATRON_CLAVE,
  PATRON_ID,
  dentroDeRepositorio,
  dirDocumentosDesarrollo,
  escribirJson,
  estaDentro,
} from "./comun.mjs";
import { ALGORITMO, ARCHIVO_CLAVE_DPAPI, cargarClave, crearClaveLocal, procesarArchivo, textoClaveLocal } from "./vigenere.mjs";
import { verificarRespaldo } from "./verificar.mjs";

export const FORMATO_CIFRADO = "softarq-respaldo-vigenere/1";
export const DIR_CIFRADOS_POR_OMISION = join(DIR_RESPALDOS_POR_OMISION, "..", "softarq_dev_vigenere");
export const DIR_DESCIFRADOS_POR_OMISION = join(DIR_WORK, "respaldo-descifrado");
const SUFIJO = ".vig";

function validarRaiz(ruta, nombre) {
  if (dentroDeRepositorio(ruta)) throw new ErrorRespaldo(`${nombre} no puede estar dentro de un repositorio.`);
  const docs = dirDocumentosDesarrollo();
  if (estaDentro(ruta, docs) || estaDentro(docs, ruta)) throw new ErrorRespaldo(`${nombre} no puede solaparse con la carpeta de documentos.`);
  return ruta;
}

function listar(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(dir, e.name)) : [join(dir, e.name)]));
}
const rel = (base, ruta) => relative(base, ruta).split("\\").join("/");

/** ¿La ruta relativa (sin sufijo) es una de las permitidas? Evita rutas arbitrarias del manifiesto. */
function rutaClaraValida(r) {
  return r === "base.dump" || r === "manifiesto.json" || (r.startsWith("documentos/") && PATRON_CLAVE.test(r.slice("documentos/".length)));
}

export async function cifrarRespaldo(carpetaOrigen, { clave, dirDestino = DIR_CIFRADOS_POR_OMISION } = {}) {
  const raiz = validarRaiz(dirDestino, "La carpeta de respaldos cifrados");
  const v = await verificarRespaldo(carpetaOrigen);
  if (!v.ok) throw new ErrorRespaldo(`El respaldo de origen no es válido; no se cifra:\n  - ${v.errores.join("\n  - ")}`);
  const m = v.manifiesto;
  if (!PATRON_ID.test(m.id)) throw new ErrorRespaldo("Identificador de respaldo inválido.");
  const final = join(raiz, m.id);
  const enCurso = `${final}.en-curso`;
  for (const r of [final, enCurso]) if (existsSync(r)) throw new ErrorRespaldo(`Ya existe ${r}; no se sobrescribe.`);
  mkdirSync(raiz, { recursive: true });
  mkdirSync(enCurso);
  try {
    const entradas = [
      { ruta: "base.dump", tipo: "VOLCADO", esperado: m.base.sha256 },
      { ruta: "manifiesto.json", tipo: "MANIFIESTO_ORIGINAL", esperado: null },
      ...m.documentos.lista.map((d) => ({ ruta: `documentos/${d.clave}`, tipo: "DOCUMENTO", esperado: d.sha256 })),
    ];
    const archivos = [];
    for (const e of entradas) {
      const origen = join(carpetaOrigen, ...e.ruta.split("/"));
      const r = await procesarArchivo(origen, join(enCurso, ...(e.ruta + SUFIJO).split("/")), clave, false);
      if (e.esperado && r.entrada.sha256 !== e.esperado) throw new ErrorRespaldo(`El archivo ${e.ruta} cambió durante el cifrado; se cancela.`);
      archivos.push({ ruta: e.ruta + SUFIJO, tipo: e.tipo, bytes: r.entrada.bytes, sha256Claro: r.entrada.sha256, bytesCifrado: r.salida.bytes, sha256Cifrado: r.salida.sha256 });
    }
    escribirJson(join(enCurso, "manifiesto-cifrado.json"), {
      formato: FORMATO_CIFRADO,
      id: m.id,
      creadoEn: new Date().toISOString(),
      respaldoOriginal: { id: m.id, creadoEn: m.creadoEn, esquema: m.esquema.ultimaMigracion },
      algoritmo: ALGORITMO,
      advertencia: "Vigenere es un requisito academico y un cifrado clasico; no sustituye a un cifrado autenticado moderno. Los SHA-256 detectan cambios pero no autentican.",
      archivos,
    });
    renameSync(enCurso, final);
    return { id: m.id, ruta: final, archivos };
  } catch (e) {
    renameSync(enCurso, `${final}.INCOMPLETO`);
    throw e;
  }
}

function leerManifiestoCifrado(carpeta) {
  const ruta = join(carpeta, "manifiesto-cifrado.json");
  if (!existsSync(ruta)) throw new ErrorRespaldo("No hay manifiesto-cifrado.json: no es un respaldo cifrado completo.");
  let mc;
  try {
    mc = JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    throw new ErrorRespaldo("manifiesto-cifrado.json no es JSON válido.");
  }
  const errores = [];
  if (mc.formato !== FORMATO_CIFRADO) errores.push(`Formato desconocido: ${mc.formato}.`);
  if (!PATRON_ID.test(mc.id ?? "")) errores.push("Identificador inválido.");
  if (basename(carpeta) !== mc.id) errores.push("La carpeta no corresponde al identificador del manifiesto.");
  if (!Array.isArray(mc.archivos)) errores.push("Falta la lista de archivos.");
  else
    for (const a of mc.archivos) {
      if (typeof a.ruta !== "string" || !a.ruta.endsWith(SUFIJO) || !rutaClaraValida(a.ruta.slice(0, -SUFIJO.length))) errores.push(`Ruta no permitida: ${a.ruta}.`);
      else if (![a.sha256Claro, a.sha256Cifrado].every((h) => /^[0-9a-f]{64}$/.test(h ?? "")) || !Number.isInteger(a.bytes) || a.bytesCifrado !== a.bytes) errores.push(`Archivo mal descrito: ${a.ruta}.`);
    }
  if (errores.length) throw new ErrorRespaldo(`Manifiesto cifrado inválido:\n  - ${errores.join("\n  - ")}`);
  return mc;
}

/**
 * Verifica (y, con `destino`, descifra a una carpeta nueva `<destino>/<ID>`). Devuelve
 * { ok, errores, id, ruta? }. No modifica el respaldo cifrado. Una clave incorrecta o un archivo
 * dañado no dejan carpeta descifrada.
 */
export async function descifrarRespaldo(carpetaCifrada, { clave, destino = null } = {}) {
  const mc = leerManifiestoCifrado(carpetaCifrada);
  const errores = [];
  const esperados = new Set(["manifiesto-cifrado.json"]);
  let enCurso = null;
  let final = null;
  if (destino) {
    validarRaiz(destino, "La carpeta de descifrado");
    final = join(destino, mc.id);
    enCurso = `${final}.en-curso`;
    for (const r of [final, enCurso]) if (existsSync(r)) throw new ErrorRespaldo(`Ya existe ${r}; no se sobrescribe.`);
    mkdirSync(destino, { recursive: true });
    mkdirSync(enCurso);
  }
  try {
    for (const a of mc.archivos) {
      const ruta = join(carpetaCifrada, ...a.ruta.split("/"));
      esperados.add(rel(carpetaCifrada, ruta));
      if (!existsSync(ruta)) {
        errores.push(`Falta ${a.ruta}.`);
        continue;
      }
      if (statSync(ruta).size !== a.bytesCifrado) {
        errores.push(`Tamaño distinto en ${a.ruta}: archivo truncado o ampliado.`);
        continue;
      }
      const clara = a.ruta.slice(0, -SUFIJO.length);
      const salida = enCurso ? join(enCurso, ...clara.split("/")) : null;
      const r = await procesarArchivo(ruta, salida, clave, true);
      if (r.entrada.sha256 !== a.sha256Cifrado) errores.push(`SHA-256 del texto cifrado distinto en ${a.ruta}: archivo alterado o dañado.`);
      else if (r.salida.sha256 !== a.sha256Claro) errores.push(`Al descifrar ${a.ruta} no se recuperan los bytes originales: clave incorrecta.`);
    }
    for (const f of listar(carpetaCifrada)) {
      if (!esperados.has(rel(carpetaCifrada, f))) errores.push(`Archivo no descrito en el manifiesto cifrado: ${rel(carpetaCifrada, f)}.`);
    }
    if (!errores.length && enCurso) {
      const orig = JSON.parse(readFileSync(join(enCurso, "manifiesto.json"), "utf8"));
      if (orig.id !== mc.id) errores.push("El manifiesto original descifrado no corresponde al identificador.");
    }
  } catch (e) {
    errores.push(`Error al procesar: ${e instanceof Error ? e.message : e}`);
  }
  if (enCurso) {
    if (errores.length) rmSync(enCurso, { recursive: true, force: true });
    else renameSync(enCurso, final);
  }
  return { ok: errores.length === 0, errores, id: mc.id, ruta: errores.length ? null : final, archivos: mc.archivos.length };
}

function opcion(args, nombre) {
  const i = args.indexOf(nombre);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function principal() {
  const [orden, ...args] = process.argv.slice(2);
  try {
    if (orden === "clave-crear") {
      const { ruta } = crearClaveLocal();
      console.log(`Clave de respaldo creada y protegida con DPAPI (misma cuenta de Windows): ${ruta}`);
      console.log("No se muestra. Guarde una copia APARTE con «pnpm respaldo:clave-mostrar --confirmar» en su propia terminal.");
      return;
    }
    if (orden === "clave-mostrar") {
      if (!args.includes("--confirmar")) throw new ErrorRespaldo("Muestra la clave en pantalla: agregue --confirmar y ejecútelo solo en su terminal.");
      if (!existsSync(ARCHIVO_CLAVE_DPAPI)) throw new ErrorRespaldo("No hay clave local.");
      console.log(textoClaveLocal());
      return;
    }
    const carpeta = args[0];
    if (!carpeta) throw new ErrorRespaldo("Falta la carpeta. Ver docs/operacion/respaldo-y-restauracion.md §9.");
    if (orden === "cifrar") {
      const r = await cifrarRespaldo(carpeta, { clave: cargarClave(), dirDestino: opcion(args, "--destino") });
      console.log(`Respaldo cifrado (Vigenère, bytes): ${r.ruta}\n  archivos cifrados: ${r.archivos.length}; el original no se modificó.`);
    } else if (orden === "verificar" || orden === "descifrar") {
      const destino = orden === "descifrar" ? (opcion(args, "--destino") ?? DIR_DESCIFRADOS_POR_OMISION) : null;
      const r = await descifrarRespaldo(carpeta, { clave: cargarClave(), destino });
      if (!r.ok) {
        console.error(`NO válido (${r.id}):\n  - ${r.errores.join("\n  - ")}`);
        process.exitCode = 1;
      } else console.log(orden === "verificar" ? `Respaldo cifrado VÁLIDO: ${r.id} (${r.archivos} archivos; los claros coinciden con sus SHA-256).` : `Descifrado y verificado por SHA-256: ${r.ruta}\n  Siguiente: pnpm respaldo:verificar "${r.ruta}"`);
    } else throw new ErrorRespaldo("Orden desconocida: use cifrar, verificar, descifrar, clave-crear o clave-mostrar.");
  } catch (e) {
    console.error(`Detenido: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await principal();
