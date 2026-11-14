#!/usr/bin/env node
// Reúne un respaldo cifrado (AES-256-GCM) publicado por el servicio en su registro privado (`respaldo-nube.mjs`),
// comprobando el SHA-256 de cada bloque y de cada archivo, y lo deja en una carpeta nueva lista para
// `respaldo:descifrar-aead`. No necesita ninguna clave: solo reconstruye el texto cifrado.
//
// Uso:  railway logs --service softarq --lines 5000 > registro.txt
//       node scripts/nube/recuperar-respaldo.mjs registro.txt <carpeta de destino>
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [archivo, destino] = process.argv.slice(2);
if (!archivo || !destino) throw new Error("Uso: recuperar-respaldo.mjs <registro.txt> <carpeta de destino>");
const sha = (b) => createHash("sha256").update(b).digest("hex");
// Sin colores ni prefijos de marca de tiempo: se buscan las líneas que contienen «SQB1».
const lineas = readFileSync(archivo, "utf8").split(/\r?\n/).map((l) => l.slice(l.indexOf("SQB1") >= 0 ? l.indexOf("SQB1") : l.length));
const indiceLinea = [...lineas].reverse().find((l) => l.startsWith("SQB1-INDICE "));
if (!indiceLinea) throw new Error("No hay un índice de respaldo en el registro.");
const indice = JSON.parse(indiceLinea.slice("SQB1-INDICE ".length));
if (!/^softarq_dev-\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(indice.id)) throw new Error("Identificador de respaldo inválido.");
const carpeta = join(destino, indice.id);
if (existsSync(carpeta)) throw new Error(`Ya existe ${carpeta}; no se sobrescribe.`);

const trozos = new Map(); // ruta → índice → bytes
for (const l of lineas) {
  if (!l.startsWith("SQB1 ")) continue;
  const [, rutaB64, pos, shaTrozo, b64] = l.split(" ");
  const ruta = Buffer.from(rutaB64, "base64url").toString();
  const [i, n] = pos.split("/").map(Number);
  const bytes = Buffer.from(b64, "base64");
  if (sha(bytes) !== shaTrozo) throw new Error(`Bloque ${i}/${n} de ${ruta} alterado o dañado.`);
  if (!trozos.has(ruta)) trozos.set(ruta, new Map());
  trozos.get(ruta).set(i, bytes);
}
let total = 0;
for (const a of indice.archivos) {
  if (a.ruta.includes("..") || a.ruta.startsWith("/")) throw new Error(`Ruta no permitida: ${a.ruta}`);
  const partes = trozos.get(a.ruta);
  if (!partes || partes.size !== a.trozos) throw new Error(`Faltan bloques de ${a.ruta} (${partes?.size ?? 0}/${a.trozos}); amplíe --lines.`);
  const datos = Buffer.concat(Array.from({ length: a.trozos }, (_, k) => partes.get(k + 1)));
  if (datos.length !== a.bytes || sha(datos) !== a.sha256) throw new Error(`El archivo ${a.ruta} no coincide con su SHA-256.`);
  const ruta = join(carpeta, ...a.ruta.split("/"));
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, datos, { flag: "wx" });
  total += datos.length;
}
console.log(`Respaldo cifrado reunido y comprobado: ${carpeta} (${indice.archivos.length} archivos, ${total} bytes). Siguiente: respaldo:descifrar-aead.`);
