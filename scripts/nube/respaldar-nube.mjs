#!/usr/bin/env node
// Respaldo cifrado del entorno en línea hasta la laptop, SIN abrir la base ni usar SSH (ADR-0025). Orquesta:
//  1. variables temporales del servicio (operación `respaldo`, contraseña del rol dueño y clave AES-256-GCM, desde _work/secrets);
//  2. un reinicio: el servicio hace el respaldo coherente, lo verifica, lo cifra y lo publica en su registro privado;
//  3. se leen los bloques del registro, se eliminan las variables temporales y se reinicia en modo normal;
//  4. se reúne el respaldo cifrado (SHA-256 por bloque y archivo), se descifra con la clave local y se verifica
//     (manifiesto, volcado legible y cada PDF por SHA-256).
// Uso (raíz del repositorio, con `railway login` hecho y el proyecto enlazado):  node scripts/nube/respaldar-nube.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { secretos } from "./_sesion.mjs";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const PROYECTO = resolve(RAIZ, "..");
const DESTINO = resolve(PROYECTO, "respaldos", "softarq_nube");
const REGISTRO = resolve(PROYECTO, "_work", "tmp", "registro-respaldo.txt");
const s = secretos();
const railway = (args) => {
  const r = spawnSync("railway", args, { encoding: "utf8", shell: true, maxBuffer: 1 << 28 });
  return { status: r.status, salida: (r.stdout ?? "") + (r.stderr ?? "") };
};
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (t) => console.log(`• ${t}`);

log("variables temporales del servicio (no se muestran)");
let r = railway(["variable", "set", "--skip-deploys", "--service", "softarq", "SOFTARQ_OPERACION=respaldo", `SOFTARQ_MIGRATOR_PASSWORD=${s.roles.migrador}`, `SOFTARQ_RESPALDO_CLAVE_AEAD=${s.claveAead}`]);
if (r.status !== 0) throw new Error("No se pudieron fijar las variables temporales.");
let linea = "";
try {
  railway(["redeploy", "--service", "softarq", "-y"]);
  for (let i = 0; i < 24 && !/SQB1-FIN /.test(linea); i++) {
    await espera(10_000);
    linea = railway(["logs", "--service", "softarq", "--lines", "5000"]).salida;
  }
  if (!/SQB1-FIN /.test(linea)) throw new Error("El servicio no publicó el respaldo a tiempo.");
  writeFileSync(REGISTRO, linea.split(/\r?\n/).filter((l) => l.includes("SQB1")).join("\n"));
  log("respaldo cifrado publicado en el registro privado");
} finally {
  for (const v of ["SOFTARQ_OPERACION", "SOFTARQ_MIGRATOR_PASSWORD", "SOFTARQ_RESPALDO_CLAVE_AEAD"]) railway(["variable", "delete", "--service", "softarq", v]);
  railway(["redeploy", "--service", "softarq", "-y"]);
  log("variables temporales eliminadas y servicio reiniciado en modo normal");
}
r = spawnSync(process.execPath, [resolve(RAIZ, "scripts", "nube", "recuperar-respaldo.mjs"), REGISTRO, DESTINO], { encoding: "utf8" });
console.log((r.stdout || r.stderr).trim());
if (r.status !== 0) throw new Error("No se pudo reunir el respaldo cifrado.");
const id = /softarq_dev-\d{8}T\d{6}Z-[0-9a-f]{6}/.exec(r.stdout)?.[0];
const { claveAeadABytes } = await import("../../apps/api/scripts/respaldo/aead.mjs");
const { descifrarRespaldoAead } = await import("../../apps/api/scripts/respaldo/cifrar-aead.mjs");
const d = await descifrarRespaldoAead(resolve(DESTINO, id), { clave: claveAeadABytes(s.claveAead) });
const m = JSON.parse(readFileSync(resolve(d.ruta, "manifiesto.json"), "utf8"));
console.log(`• descifrado y verificado: ${id} · estado ${m.estado} · documentos ${m.documentos.total}/${m.documentos.referenciados} · tablas ${Object.keys(m.conteos).length} · última migración ${m.esquema.ultimaMigracion}`);
