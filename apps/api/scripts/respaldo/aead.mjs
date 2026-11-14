/**
 * Cifrado AUTENTICADO moderno de los respaldos del entorno en línea (ADR-0025): AES-256-GCM por bloques.
 * Complementa —no sustituye— a Vigenère (requisito académico, ADR-0024).
 *
 * Formato de cada archivo cifrado (.sqa):
 *   "SQA1" (4) | tamaño de bloque en bytes (u32 BE) | prefijo de nonce aleatorio de 4 bytes
 *   y, por cada bloque:  longitud del texto cifrado (u32 BE) | texto cifrado | etiqueta GCM (16)
 * - Nonce de 12 bytes = prefijo (4) + contador de bloque (u64 BE): nunca se repite con la misma clave en un archivo
 *   y el prefijo aleatorio distingue archivos.
 * - Datos adicionales autenticados (AAD) = cabecera (12) + índice de bloque + indicador de último bloque.
 *   Así se detectan bloques alterados, reordenados, repetidos, quitados y el archivo truncado.
 * - Clave: 32 bytes aleatorios en base64url (SOFTARQ_RESPALDO_CLAVE_AEAD), distinta de la de Vigenère,
 *   guardada en el gestor de secretos y nunca junto al respaldo ni en Git.
 * Procesa por bloques de 1 MiB: nunca carga un archivo completo en memoria.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { ErrorRespaldo } from "./comun.mjs";

export const VARIABLE_CLAVE_AEAD = "SOFTARQ_RESPALDO_CLAVE_AEAD";
export const BLOQUE = 1024 * 1024;
const MAGIA = Buffer.from("SQA1", "latin1");
const ETIQUETA = 16;
const CABECERA = 12;

/** Genera una clave nueva (no se imprime aquí: la devuelve a quien la guarda en el gestor de secretos). */
export const generarClaveAead = () => randomBytes(32).toString("base64url");

export function claveAeadABytes(texto) {
  if (typeof texto !== "string" || texto === "") throw new ErrorRespaldo(`Falta la clave AEAD (${VARIABLE_CLAVE_AEAD}).`);
  const b = Buffer.from(texto, "base64url");
  if (b.length !== 32) throw new ErrorRespaldo("La clave AEAD debe ser de 32 bytes (base64url).");
  return b;
}

export function cargarClaveAead(entorno = process.env) {
  return claveAeadABytes(entorno[VARIABLE_CLAVE_AEAD]);
}

const nonce = (prefijo, indice) => {
  const n = Buffer.alloc(12);
  prefijo.copy(n, 0);
  n.writeBigUInt64BE(BigInt(indice), 4);
  return n;
};
const aad = (cabecera, indice, ultimo) => {
  const a = Buffer.alloc(CABECERA + 9);
  cabecera.copy(a, 0);
  a.writeBigUInt64BE(BigInt(indice), CABECERA);
  a[CABECERA + 8] = ultimo ? 1 : 0;
  return a;
};

/** Lee exactamente `n` bytes (o menos solo al final del archivo). */
async function leerN(iterador, pendiente, n) {
  const partes = pendiente.length ? [pendiente] : [];
  let total = pendiente.length;
  while (total < n) {
    const { value, done } = await iterador.next();
    if (done) break;
    partes.push(value);
    total += value.length;
  }
  const todo = Buffer.concat(partes);
  return { dato: todo.subarray(0, Math.min(n, todo.length)), resto: todo.subarray(Math.min(n, todo.length)) };
}

async function* escribirEn(destino, generador) {
  const temporal = `${destino}.${randomBytes(4).toString("hex")}.parcial`;
  if (existsSync(destino)) throw new ErrorRespaldo(`Ya existe ${destino}; no se sobrescribe.`);
  mkdirSync(dirname(destino), { recursive: true });
  const salida = createWriteStream(temporal, { flags: "wx" });
  try {
    for await (const trozo of generador) {
      if (!salida.write(trozo)) await new Promise((ok) => salida.once("drain", ok));
    }
    await new Promise((ok, mal) => salida.end((e) => (e ? mal(e) : ok())));
    renameSync(temporal, destino);
  } catch (e) {
    salida.destroy();
    rmSync(temporal, { force: true });
    throw e;
  }
}

/** Cifra `origen` → `destino` (.sqa). Devuelve los bytes escritos. */
export async function cifrarArchivoAead(origen, destino, clave) {
  const prefijo = randomBytes(4);
  const cabecera = Buffer.alloc(CABECERA);
  MAGIA.copy(cabecera, 0);
  cabecera.writeUInt32BE(BLOQUE, 4);
  prefijo.copy(cabecera, 8);
  const it = createReadStream(origen, { highWaterMark: BLOQUE })[Symbol.asyncIterator]();
  let escritos = 0;
  async function* generar() {
    yield cabecera;
    escritos += CABECERA;
    let resto = Buffer.alloc(0);
    let indice = 0;
    // Se lee un bloque por adelantado para saber cuál es el último.
    let actual = await leerN(it, resto, BLOQUE);
    for (;;) {
      const siguiente = await leerN(it, actual.resto, BLOQUE);
      const ultimo = siguiente.dato.length === 0;
      const c = createCipheriv("aes-256-gcm", clave, nonce(prefijo, indice));
      c.setAAD(aad(cabecera, indice, ultimo));
      const texto = Buffer.concat([c.update(actual.dato), c.final()]);
      const largo = Buffer.alloc(4);
      largo.writeUInt32BE(texto.length, 0);
      yield largo;
      yield texto;
      yield c.getAuthTag();
      escritos += 4 + texto.length + ETIQUETA;
      if (ultimo) break;
      actual = { dato: siguiente.dato, resto: siguiente.resto };
      indice += 1;
    }
  }
  if (destino) for await (const _ of escribirEn(destino, generar())) void _;
  else for await (const _ of generar()) void _;
  return escritos;
}

/** Descifra `origen` (.sqa) → `destino` (o solo verifica si es null). Lanza ErrorRespaldo si algo no autentica. */
export async function descifrarArchivoAead(origen, destino, clave) {
  const it = createReadStream(origen, { highWaterMark: BLOQUE + 64 })[Symbol.asyncIterator]();
  const fallo = () => new ErrorRespaldo("Archivo cifrado alterado, truncado o clave incorrecta (la autenticación AEAD falló).");
  let { dato: cabecera, resto } = await leerN(it, Buffer.alloc(0), CABECERA);
  if (cabecera.length < CABECERA || !cabecera.subarray(0, 4).equals(MAGIA)) throw new ErrorRespaldo("No es un archivo SQA1.");
  const tamBloque = cabecera.readUInt32BE(4);
  if (tamBloque !== BLOQUE) throw new ErrorRespaldo("Tamaño de bloque no admitido.");
  const prefijo = Buffer.from(cabecera.subarray(8, 12));
  let bytes = 0;
  async function* generar() {
    let indice = 0;
    for (;;) {
      const l = await leerN(it, resto, 4);
      if (l.dato.length < 4) throw fallo(); // falta el último bloque: truncado
      const largo = l.dato.readUInt32BE(0);
      if (largo > BLOQUE) throw fallo();
      const t = await leerN(it, l.resto, largo + ETIQUETA);
      if (t.dato.length < largo + ETIQUETA) throw fallo();
      resto = t.resto;
      // ¿Es el último bloque? Lo es si ya no queda nada más en el archivo.
      const sig = await leerN(it, resto, 1);
      const ultimo = sig.dato.length === 0;
      resto = Buffer.concat([sig.dato, sig.resto]);
      const d = createDecipheriv("aes-256-gcm", clave, nonce(prefijo, indice));
      d.setAAD(aad(cabecera, indice, ultimo));
      d.setAuthTag(t.dato.subarray(largo));
      let claro;
      try {
        claro = Buffer.concat([d.update(t.dato.subarray(0, largo)), d.final()]);
      } catch {
        throw fallo();
      }
      bytes += claro.length;
      yield claro;
      if (ultimo) break;
      indice += 1;
    }
  }
  if (destino) for await (const _ of escribirEn(destino, generar())) void _;
  else for await (const _ of generar()) void _;
  return bytes;
}
