/**
 * Cifrado Vigenère sobre bytes para el respaldo (requisito académico; ADR-0024).
 *
 * Adaptación del algoritmo clásico (ver docs/operacion/respaldo-y-restauracion.md §9):
 * - Alfabeto: los 256 valores de un byte (0–255), no las 26 letras. Así sirve para binarios
 *   (volcado de PostgreSQL, PDF) sin codificarlos antes; no se usa Base64.
 * - Clave: el texto se normaliza a NFC y se toma su UTF-8; cada byte es un desplazamiento 0–255.
 *   Mínimo 16 bytes. La clave se repite cíclicamente desde el desplazamiento 0 de CADA archivo.
 * - Cifrar: c = (p + k[i mod n]) mod 256. Descifrar: p = (c − k[i mod n]) mod 256.
 *
 * Es un cifrado clásico: NO es un cifrado moderno, no autentica ni oculta patrones. La integridad
 * la comprueban los SHA-256 del manifiesto (que no son autenticación criptográfica).
 *
 * Memoria: el procesamiento es por bloques (Transform); nunca se carga un archivo completo.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DIR_WORK, ErrorRespaldo } from "./comun.mjs";

export const LONGITUD_MINIMA_CLAVE = 16;
export const ALGORITMO = Object.freeze({
  nombre: "vigenere-bytes-256",
  alfabeto: "bytes 0-255 (aritmetica modulo 256)",
  clave: "UTF-8 de la frase (NFC), minimo 16 bytes, repetida ciclicamente desde el byte 0 de cada archivo",
  contenedor: "sin cabecera: el archivo cifrado tiene el mismo tamano que el original",
});
export const VARIABLE_CLAVE = "SOFTARQ_RESPALDO_CLAVE_VIGENERE";
export const ARCHIVO_CLAVE_DPAPI = join(DIR_WORK, "secrets", "respaldo-vigenere.dpapi");

/** Convierte la frase en los desplazamientos (bytes) de la clave. Nunca imprime la clave. */
export function claveABytes(frase) {
  if (typeof frase !== "string" || frase.length === 0) throw new ErrorRespaldo("Falta la clave de Vigenère.");
  const bytes = Buffer.from(frase.normalize("NFC"), "utf8");
  if (bytes.length < LONGITUD_MINIMA_CLAVE) throw new ErrorRespaldo(`La clave de Vigenère debe tener al menos ${LONGITUD_MINIMA_CLAVE} bytes.`);
  return bytes;
}

/** Cifra o descifra un bloque en el sitio; `desplazamiento` es la posición global en el archivo. */
export function aplicarBloque(bloque, clave, desplazamiento, descifrar) {
  const n = clave.length;
  let j = desplazamiento % n;
  if (descifrar) for (let i = 0; i < bloque.length; i++) { bloque[i] = (bloque[i] - clave[j] + 256) & 255; if (++j === n) j = 0; }
  else for (let i = 0; i < bloque.length; i++) { bloque[i] = (bloque[i] + clave[j]) & 255; if (++j === n) j = 0; }
  return bloque;
}

/** Transform por bloques (el bloque de entrada se copia: no se modifica el búfer del lector). */
export function transformarVigenere(clave, descifrar) {
  let posicion = 0;
  return new Transform({
    transform(trozo, _c, cb) {
      const copia = Buffer.from(trozo);
      aplicarBloque(copia, clave, posicion, descifrar);
      posicion += copia.length;
      cb(null, copia);
    },
  });
}

/** SHA-256 de lo que pasa, sin retener los datos. */
function medidor() {
  const hash = createHash("sha256");
  let bytes = 0;
  const t = new Transform({
    transform(trozo, _c, cb) {
      hash.update(trozo);
      bytes += trozo.length;
      cb(null, trozo);
    },
  });
  return { t, resultado: () => ({ sha256: hash.digest("hex"), bytes }) };
}

/**
 * Cifra/descifra `origen` → `destino` por bloques y devuelve SHA-256 y tamaño de entrada y salida.
 * El destino se escribe en un temporal exclusivo y se renombra solo al terminar; no sobrescribe.
 * Si `destino` es null, solo mide (verificación sin escribir).
 */
export async function procesarArchivo(origen, destino, clave, descifrar) {
  const entrada = medidor();
  const salida = medidor();
  if (destino && existsSync(destino)) throw new ErrorRespaldo(`Ya existe ${destino}; no se sobrescribe.`);
  const etapas = [createReadStream(origen, { highWaterMark: 256 * 1024 }), entrada.t, transformarVigenere(clave, descifrar), salida.t];
  if (destino) {
    mkdirSync(dirname(destino), { recursive: true });
    const temporal = `${destino}.${randomBytes(4).toString("hex")}.parcial`;
    try {
      await pipeline(...etapas, createWriteStream(temporal, { flags: "wx" }));
      renameSync(temporal, destino);
    } catch (e) {
      rmSync(temporal, { force: true });
      throw e;
    }
  } else {
    await pipeline(...etapas, new Transform({ transform: (_t, _c, cb) => cb() }));
  }
  return { entrada: entrada.resultado(), salida: salida.resultado() };
}

// ---------------------------------------------------------------------------------------------
// Clave: variable de entorno (pruebas) o archivo protegido con DPAPI (misma cuenta de Windows)
// ---------------------------------------------------------------------------------------------

function powershell(script, entrada) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    input: entrada,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) throw new ErrorRespaldo("DPAPI (PowerShell) no pudo procesar la clave; ¿misma cuenta de Windows?");
  return r.stdout.replace(/\r?\n$/, "");
}

/** Genera una clave aleatoria de 256 bits (base64url) y la guarda cifrada con DPAPI. No la imprime. */
export function crearClaveLocal(ruta = ARCHIVO_CLAVE_DPAPI) {
  if (existsSync(ruta)) throw new ErrorRespaldo("Ya existe una clave de respaldo; no se sobrescribe (se perderían los respaldos cifrados con ella).");
  const frase = randomBytes(32).toString("base64url");
  const protegida = powershell("$s = [Console]::In.ReadLine() | ConvertTo-SecureString -AsPlainText -Force; ConvertFrom-SecureString $s", frase + "\n");
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, protegida + "\n", { encoding: "ascii", flag: "wx" });
  return { ruta };
}

/** Devuelve la clave en bytes o lanza con un mensaje claro (nunca con la clave). */
export function cargarClave({ ruta = ARCHIVO_CLAVE_DPAPI, entorno = process.env } = {}) {
  const deEntorno = entorno[VARIABLE_CLAVE];
  if (deEntorno) return claveABytes(deEntorno);
  if (!existsSync(ruta)) {
    throw new ErrorRespaldo(`No hay clave de Vigenère: defina ${VARIABLE_CLAVE} o cree la clave local con «pnpm respaldo:clave-crear».`);
  }
  const protegida = readFileSync(ruta, "ascii").trim();
  const frase = powershell(
    "$p = [Console]::In.ReadLine() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))",
    protegida + "\n",
  );
  return claveABytes(frase);
}

/** Texto de la clave local (solo para que su propietario la guarde aparte; no se registra). */
export function textoClaveLocal(ruta = ARCHIVO_CLAVE_DPAPI) {
  const protegida = readFileSync(ruta, "ascii").trim();
  return powershell(
    "$p = [Console]::In.ReadLine() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))",
    protegida + "\n",
  );
}
