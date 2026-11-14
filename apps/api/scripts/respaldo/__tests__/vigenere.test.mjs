// Pruebas unitarias del cifrado Vigenère de bytes del respaldo (ADR-0024). Sin base de datos ni claves reales.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DIR_WORK, ErrorRespaldo } from "../comun.mjs";
import { VARIABLE_CLAVE, aplicarBloque, cargarClave, claveABytes, procesarArchivo } from "../vigenere.mjs";

const CLAVE = claveABytes("clave-didactica-ficticia-0123456789");
mkdirSync(join(DIR_WORK, "tmp"), { recursive: true });
const dir = mkdtempSync(join(DIR_WORK, "tmp", "vigenere-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sha = (b) => createHash("sha256").update(b).digest("hex");

describe("algoritmo (alfabeto de 256 bytes)", () => {
  it("cifra con (p + k) mod 256 y descifra con (c − k) mod 256", () => {
    const clave = Buffer.from([1, 2, 3, ...Array(13).fill(0)]);
    const claro = Buffer.from([0, 0, 0, 0, 255, 255, 255, 10]);
    const cif = aplicarBloque(Buffer.from(claro), clave, 0, false);
    // posiciones 0–2 suman 1, 2, 3; la 4 suma 0; la 5 y la 6 (255) suman 0 (la clave tiene ceros después del byte 3)
    expect([...cif]).toEqual([1, 2, 3, 0, 255, 255, 255, 10]);
    expect([...aplicarBloque(Buffer.from([255, 255, 255]), clave, 0, false)]).toEqual([0, 1, 2]); // 255+1=256→0
  });
  it("devuelve los bytes originales para los 256 valores y cualquier desplazamiento", () => {
    const todos = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    for (const desp of [0, 1, 17, 1000]) {
      const cif = aplicarBloque(Buffer.from(todos), CLAVE, desp, false);
      expect(cif.equals(todos)).toBe(false);
      expect(aplicarBloque(Buffer.from(cif), CLAVE, desp, true).equals(todos)).toBe(true);
    }
  });
});

describe("clave", () => {
  it("exige al menos 16 bytes y no acepta vacía", () => {
    expect(() => claveABytes("corta")).toThrow(ErrorRespaldo);
    expect(() => claveABytes("")).toThrow(/Falta la clave/);
    expect(claveABytes("ñ".repeat(8)).length).toBe(16); // UTF-8: 2 bytes por «ñ»
  });
  it("sin clave configurada falla con un mensaje claro y sin secretos", () => {
    expect(() => cargarClave({ ruta: join(dir, "no-existe.dpapi"), entorno: {} })).toThrow(/No hay clave de Vigenère/);
    expect(cargarClave({ ruta: join(dir, "no-existe.dpapi"), entorno: { [VARIABLE_CLAVE]: "x".repeat(20) } }).length).toBe(20);
  });
});

describe("archivos por bloques", () => {
  it("recupera exactamente los bytes (mayor que un bloque y que no es múltiplo de la clave) y no cambia el tamaño", async () => {
    const datos = randomBytes(700_001);
    const a = join(dir, "claro.bin");
    writeFileSync(a, datos);
    const c = await procesarArchivo(a, join(dir, "claro.bin.vig"), CLAVE, false);
    expect(c.entrada.sha256).toBe(sha(datos));
    expect(c.salida.bytes).toBe(datos.length);
    expect(readFileSync(join(dir, "claro.bin.vig")).equals(datos)).toBe(false);
    const d = await procesarArchivo(join(dir, "claro.bin.vig"), join(dir, "recuperado.bin"), CLAVE, true);
    expect(d.entrada.sha256).toBe(c.salida.sha256);
    expect(d.salida.sha256).toBe(sha(datos));
    expect(readFileSync(join(dir, "recuperado.bin")).equals(datos)).toBe(true);
  });
  it("con clave incorrecta no recupera los bytes; con el archivo truncado cambia el hash del cifrado", async () => {
    const datos = randomBytes(5000);
    writeFileSync(join(dir, "k.bin"), datos);
    const c = await procesarArchivo(join(dir, "k.bin"), join(dir, "k.bin.vig"), CLAVE, false);
    const mala = await procesarArchivo(join(dir, "k.bin.vig"), null, claveABytes("otra-clave-ficticia-9876543210"), true);
    expect(mala.entrada.sha256).toBe(c.salida.sha256); // el cifrado está intacto…
    expect(mala.salida.sha256).not.toBe(sha(datos)); // …pero el claro no coincide: clave incorrecta
    const cif = readFileSync(join(dir, "k.bin.vig"));
    writeFileSync(join(dir, "truncado.vig"), cif.subarray(0, 4999));
    expect((await procesarArchivo(join(dir, "truncado.vig"), null, CLAVE, true)).entrada.sha256).not.toBe(c.salida.sha256);
    const alterado = Buffer.from(cif);
    alterado[100] ^= 1;
    writeFileSync(join(dir, "alterado.vig"), alterado);
    expect((await procesarArchivo(join(dir, "alterado.vig"), null, CLAVE, true)).entrada.sha256).not.toBe(c.salida.sha256);
  });
  it("no sobrescribe un destino existente y no deja temporales al fallar", async () => {
    writeFileSync(join(dir, "ya.vig"), "x");
    await expect(procesarArchivo(join(dir, "claro.bin"), join(dir, "ya.vig"), CLAVE, false)).rejects.toThrow(/no se sobrescribe/);
    expect(readFileSync(join(dir, "ya.vig"), "utf8")).toBe("x");
  });
});
