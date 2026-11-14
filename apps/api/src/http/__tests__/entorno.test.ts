/** Validación de la configuración al arrancar (sin base de datos). */
import { describe, expect, it } from "vitest";
import { ErrorConfiguracion, leerConfiguracion } from "../../config/entorno.js";

const CLAVE = "clave-secreta-de-prueba-123";
const base = { DATABASE_URL: `postgresql://softarq_app:${CLAVE}@localhost:5432/softarq_dev` };

function fallo(entorno: Record<string, string | undefined>): string {
  try {
    leerConfiguracion(entorno);
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorConfiguracion);
    const mensaje = (e as Error).message;
    expect(mensaje, "el mensaje nunca incluye la contraseña").not.toContain(CLAVE);
    return mensaje;
  }
  throw new Error("se esperaba un error de configuración");
}

describe("configuración de la API", () => {
  it("valores por omisión seguros", () => {
    expect(leerConfiguracion(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      despliegue: "local",
      cookieSegura: false,
      confiarProxy: 0,
      hsts: false,
      dirWeb: null,
      host: "127.0.0.1",
      puerto: 3000,
      // Módulo 5: solo localhost (la cookie SameSite=Strict exige el mismo site que la API, ADR-0007).
      origenesCors: ["http://localhost:5173"],
      // Módulo 17: por omisión el panel es el primer origen permitido.
      panelUrl: "http://localhost:5173",
      limiteGeneralPorMinuto: 120,
      limiteCalculoPorMinuto: 30,
      limiteCuerpoKb: 128,
      accesos: { ventanaMs: 15 * 60_000, fallosPorCuentaEIp: 5, fallosPorCuenta: 20, intentosPorIp: 30 },
      zonaHoraria: "America/Mexico_City",
      // Módulo 8: sin carpeta de documentos la configuración es válida (pruebas), pero main.ts no arranca.
      dirDocumentos: null,
      registro: "completo",
    });
  });

  it("SOFTARQ_DIR_DOCUMENTOS: ruta absoluta (módulo 8)", () => {
    expect(leerConfiguracion({ ...base, SOFTARQ_DIR_DOCUMENTOS: "D:\\Proyecto_SoftArq\\datos\\documentos" }).dirDocumentos).toBe(
      "D:\\Proyecto_SoftArq\\datos\\documentos",
    );
    expect(() => leerConfiguracion({ ...base, SOFTARQ_DIR_DOCUMENTOS: "datos/documentos" })).toThrow(/SOFTARQ_DIR_DOCUMENTOS/);
  });

  it.each([
    ["API_HOST distinto de 127.0.0.1", { API_HOST: "0.0.0.0" }, /API_HOST/],
    ["CORS con comodín", { API_CORS_ORIGINS: "*" }, /nunca "\*"/],
    ["CORS no local", { API_CORS_ORIGINS: "https://ejemplo.com" }, /orígenes locales/],
    ["puerto inválido", { API_PORT: "80" }, /API_PORT/],
    ["zona horaria inválida", { SOFTARQ_ZONA_HORARIA: "Marte/Olimpo" }, /SOFTARQ_ZONA_HORARIA/],
    ["límite no numérico", { API_LIMITE_CALCULO_POR_MINUTO: "muchos" }, /API_LIMITE_CALCULO_POR_MINUTO/],
    // ADR-0007: la cookie sin Secure solo es admisible en local por HTTP.
    ["NODE_ENV de producción", { NODE_ENV: "production" }, /NODE_ENV=production/],
    ["origen https (la cookie no lleva Secure)", { API_CORS_ORIGINS: "https://localhost:5173" }, /orígenes locales/],
    ["límite de accesos fuera de rango", { API_ACCESO_FALLOS_CUENTA_IP: "0" }, /API_ACCESO_FALLOS_CUENTA_IP/],
  ])("rechaza %s", (_n, extra, patron) => {
    expect(fallo({ ...base, ...extra })).toMatch(patron);
  });

  it.each(["postgres", "softarq_migrator"])("rechaza ejecutar el servidor con el rol %s", (rol) => {
    expect(fallo({ DATABASE_URL: `postgresql://${rol}:${CLAVE}@localhost:5432/softarq_dev` })).toMatch(/softarq_app/);
  });

  it("rechaza una base de datos remota o sin URL", () => {
    expect(fallo({ DATABASE_URL: `postgresql://softarq_app:${CLAVE}@db.ejemplo.com:5432/x` })).toMatch(/local/);
    expect(fallo({})).toMatch(/DATABASE_URL/);
  });

  it("acepta orígenes locales explícitos", () => {
    const c = leerConfiguracion({ ...base, API_CORS_ORIGINS: "http://localhost:5173, http://127.0.0.1:4173" });
    expect(c.origenesCors).toEqual(["http://localhost:5173", "http://127.0.0.1:4173"]);
  });
});

describe("despliegue en la nube (ADR-0025)", () => {
  const interno = "postgresql://softarq_app:clave-secreta-de-prueba-123@postgres.railway.internal:5432/railway";
  const nubeBase = { DATABASE_URL: interno, SOFTARQ_DESPLIEGUE: "nube", NODE_ENV: "production", API_PUBLIC_URL: "https://softarq-demo.up.railway.app", PORT: "8080" };

  it("escucha en 0.0.0.0:PORT con origen https, cookie Secure, HSTS y un salto de proxy", () => {
    const c = leerConfiguracion(nubeBase);
    expect(c).toMatchObject({ despliegue: "nube", host: "0.0.0.0", puerto: 8080, cookieSegura: true, hsts: true, confiarProxy: 1 });
    expect(c.origenesCors).toEqual(["https://softarq-demo.up.railway.app"]);
    expect(c.panelUrl).toBe("https://softarq-demo.up.railway.app");
  });

  it.each([
    ["sin NODE_ENV=production", { NODE_ENV: undefined }, /NODE_ENV=production/],
    ["sin origen público", { API_PUBLIC_URL: undefined }, /API_PUBLIC_URL/],
    ["origen http", { API_PUBLIC_URL: "http://softarq-demo.up.railway.app" }, /API_PUBLIC_URL/],
    ["origen con ruta", { API_PUBLIC_URL: "https://softarq-demo.up.railway.app/app" }, /API_PUBLIC_URL/],
    ["CORS explícito", { API_CORS_ORIGINS: "https://otro.example" }, /API_CORS_ORIGINS/],
    ["base fuera de la red privada", { DATABASE_URL: "postgresql://softarq_app:clave-secreta-de-prueba-123@db.example.com:5432/railway" }, /red privada/],
    ["rol administrativo", { DATABASE_URL: "postgresql://postgres:clave-secreta-de-prueba-123@postgres.railway.internal:5432/railway" }, /rol administrativo/],
    ["host distinto de 0.0.0.0", { API_HOST: "127.0.0.1" }, /0.0.0.0/],
  ])("rechaza: %s", (_n, cambio, patron) => {
    expect(() => leerConfiguracion({ ...nubeBase, ...cambio })).toThrow(patron);
  });

  it("en local no admite API_PUBLIC_URL, ni hosts de red, ni NODE_ENV=production", () => {
    expect(() => leerConfiguracion({ ...base, API_PUBLIC_URL: "https://softarq-demo.up.railway.app" })).toThrow(/API_PUBLIC_URL/);
    expect(() => leerConfiguracion({ ...base, API_HOST: "0.0.0.0" })).toThrow(/127.0.0.1/);
    expect(() => leerConfiguracion({ ...base, NODE_ENV: "production" })).toThrow(/NODE_ENV=production/);
  });

  it("los mensajes de error nunca incluyen la contraseña de la base", () => {
    try {
      leerConfiguracion({ ...nubeBase, API_PUBLIC_URL: undefined });
    } catch (e) {
      expect(String(e)).not.toContain("clave-secreta-de-prueba-123");
    }
  });
});
