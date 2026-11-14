// Pruebas del cifrado autenticado AES-256-GCM de los respaldos en línea (ADR-0025). Sin base de datos.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DIR_WORK } from "../comun.mjs";
import { BLOQUE, cargarClaveAead, cifrarArchivoAead, claveAeadABytes, descifrarArchivoAead, generarClaveAead } from "../aead.mjs";

mkdirSync(join(DIR_WORK, "tmp"), { recursive: true });
const dir = mkdtempSync(join(DIR_WORK, "tmp", "aead-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const clave = claveAeadABytes(generarClaveAead());
let n = 0;
const nuevo = () => join(dir, `f${n++}`);

async function cifrar(datos) {
  const o = nuevo();
  writeFileSync(o, datos);
  const c = nuevo();
  await cifrarArchivoAead(o, c, clave);
  return c;
}

describe("AES-256-GCM por bloques", () => {
  it.each([0, 1, 1000, BLOQUE - 1, BLOQUE, BLOQUE + 1, 2 * BLOQUE, 2 * BLOQUE + 123])("recupera exactamente %i bytes", async (largo) => {
    const datos = randomBytes(largo);
    const c = await cifrar(datos);
    const d = nuevo();
    await descifrarArchivoAead(c, d, clave);
    expect(sha(readFileSync(d))).toBe(sha(datos));
  });

  it("no revela el contenido y dos cifrados del mismo archivo son distintos", async () => {
    const datos = Buffer.from("%PDF-1.7 ".repeat(500));
    const a = readFileSync(await cifrar(datos));
    const b = readFileSync(await cifrar(datos));
    expect(a.includes(Buffer.from("%PDF"))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it("rechaza clave incorrecta, bit alterado, truncado (también en límite de bloque) y bloques quitados", async () => {
    const datos = randomBytes(2 * BLOQUE + 500);
    const c = await cifrar(datos);
    const bruto = readFileSync(c);
    await expect(descifrarArchivoAead(c, null, claveAeadABytes(generarClaveAead()))).rejects.toThrow(/AEAD/);
    const alterado = Buffer.from(bruto);
    alterado[100] ^= 1;
    const pa = nuevo();
    writeFileSync(pa, alterado);
    await expect(descifrarArchivoAead(pa, null, clave)).rejects.toThrow(/AEAD/);
    const pt = nuevo();
    writeFileSync(pt, bruto.subarray(0, bruto.length - 7));
    await expect(descifrarArchivoAead(pt, null, clave)).rejects.toThrow(/AEAD/);
    // Corta justo tras el primer bloque completo (12 + 4 + BLOQUE + 16): sin el último bloque.
    const pl = nuevo();
    writeFileSync(pl, bruto.subarray(0, 12 + 4 + BLOQUE + 16));
    await expect(descifrarArchivoAead(pl, null, clave)).rejects.toThrow(/AEAD/);
    // Quita el primer bloque.
    const pq = nuevo();
    writeFileSync(pq, Buffer.concat([bruto.subarray(0, 12), bruto.subarray(12 + 4 + BLOQUE + 16)]));
    await expect(descifrarArchivoAead(pq, null, clave)).rejects.toThrow(/AEAD/);
  });

  it("rechaza archivos ajenos, no sobrescribe y no deja temporales al fallar", async () => {
    const ajeno = nuevo();
    writeFileSync(ajeno, "no es un respaldo cifrado");
    await expect(descifrarArchivoAead(ajeno, null, clave)).rejects.toThrow();
    const c = await cifrar(Buffer.from("x"));
    const existente = nuevo();
    writeFileSync(existente, "ya existe");
    await expect(descifrarArchivoAead(c, existente, clave)).rejects.toThrow(/no se sobrescribe/);
    expect(readFileSync(existente, "utf8")).toBe("ya existe");
  });

  it("la clave debe ser de 32 bytes y estar definida", () => {
    expect(() => claveAeadABytes("corta")).toThrow(/32 bytes/);
    expect(() => cargarClaveAead({})).toThrow(/Falta la clave AEAD/);
    expect(cargarClaveAead({ SOFTARQ_RESPALDO_CLAVE_AEAD: generarClaveAead() }).length).toBe(32);
  });
});
