/**
 * Configuración de la API validada al arrancar (ADR-0005, ADR-0025). Si algo es inválido, el arranque
 * falla con un mensaje claro que NUNCA incluye valores secretos (solo el nombre de la variable y la regla).
 *
 * Dos despliegues, ambos estrictos (ADR-0025):
 * - `local` (por omisión): HTTP en 127.0.0.1, orígenes http locales, cookie sin `Secure` (sin TLS).
 * - `nube`: HTTPS detrás del proxy de la plataforma, escucha en 0.0.0.0:PORT, base solo por red privada,
 *   un único origen público https (panel y API comparten origen), cookie `Secure`, HSTS y un salto de proxy.
 * `nube` no desactiva protecciones: cambia cuáles aplican a cada entorno.
 */
import { z } from "zod";

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Roles que nunca deben usarse para ejecutar el servidor. */
const ROLES_PROHIBIDOS = new Set(["postgres", "softarq_migrator"]);
/** Orígenes locales: solo http en loopback (la cookie de sesión no lleva `Secure` en local). */
const ORIGEN_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
/** Origen público en la nube: solo https, sin ruta, credenciales ni puerto explícito. */
const ORIGEN_HTTPS = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const RUTA_ABSOLUTA = /^([A-Za-z]:[\\/]|\/)/;

const entero = (nombre: string, min: number, max: number, porOmision: number) =>
  z
    .string()
    .regex(/^\d+$/, { error: `${nombre} debe ser un entero.` })
    .transform(Number)
    .pipe(z.number().int().min(min, { error: `${nombre} mínimo ${min}.` }).max(max, { error: `${nombre} máximo ${max}.` }))
    .optional()
    .transform((v) => v ?? porOmision);

const EsquemaEntorno = z.object({
  SOFTARQ_DESPLIEGUE: z
    .enum(["local", "nube"], { error: "SOFTARQ_DESPLIEGUE: local | nube." })
    .optional()
    .transform((v) => v ?? "local"),
  DATABASE_URL: z
    .string({ error: "Falta DATABASE_URL (apps/api/.env; ver db:credenciales)." })
    .refine((v) => URL.canParse(v), { error: "DATABASE_URL no es una URL válida." })
    .refine((v) => /^postgres(ql)?:$/.test(new URL(v).protocol), { error: "DATABASE_URL debe ser postgresql://." })
    .refine((v) => !ROLES_PROHIBIDOS.has(decodeURIComponent(new URL(v).username)), {
      error: "DATABASE_URL usa un rol administrativo o de migración; el servidor debe usar softarq_app.",
    }),
  API_HOST: z.string().optional(),
  PORT: entero("PORT", 1, 65535, 0),
  API_PORT: entero("API_PORT", 1, 65535, 0),
  API_CORS_ORIGINS: z.string().optional(),
  // Origen público https de la API y del panel (mismo origen); solo en la nube.
  API_PUBLIC_URL: z.string().optional(),
  // Módulo 17 (ADR-0021): dirección del panel del equipo que la app muestra a una cuenta interna.
  API_PANEL_URL: z.string().optional(),
  // Carpeta del panel compilado (apps/web/dist) que la API sirve en el mismo origen (opcional).
  SOFTARQ_DIR_WEB: z.string().optional(),
  API_LIMITE_GENERAL_POR_MINUTO: entero("API_LIMITE_GENERAL_POR_MINUTO", 1, 10000, 120),
  API_LIMITE_CALCULO_POR_MINUTO: entero("API_LIMITE_CALCULO_POR_MINUTO", 1, 1000, 30),
  API_LIMITE_CUERPO_KB: entero("API_LIMITE_CUERPO_KB", 1, 1024, 128),
  // Límites de intentos de acceso (ADR-0007 §4): ventanas fijas en memoria, nunca permanentes.
  API_ACCESO_VENTANA_MINUTOS: entero("API_ACCESO_VENTANA_MINUTOS", 1, 1440, 15),
  API_ACCESO_FALLOS_CUENTA_IP: entero("API_ACCESO_FALLOS_CUENTA_IP", 1, 100, 5),
  API_ACCESO_FALLOS_CUENTA: entero("API_ACCESO_FALLOS_CUENTA", 1, 1000, 20),
  API_ACCESO_INTENTOS_IP: entero("API_ACCESO_INTENTOS_IP", 1, 10000, 30),
  NODE_ENV: z.string().optional(),
  SOFTARQ_ZONA_HORARIA: z
    .string()
    .optional()
    .transform((v) => v ?? "America/Mexico_City")
    .refine(
      (v) => {
        try {
          new Intl.DateTimeFormat("en-CA", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      },
      { error: "SOFTARQ_ZONA_HORARIA no es una zona horaria IANA válida." },
    ),
  // Módulo 8 (ADR-0010): carpeta persistente de los PDF emitidos (no es caché ni temporal). Ruta
  // absoluta; en la nube, el punto de montaje de un volumen persistente. Sin ella, `main.ts` no arranca.
  SOFTARQ_DIR_DOCUMENTOS: z
    .string()
    .optional()
    .refine((v) => v === undefined || RUTA_ABSOLUTA.test(v), {
      error: "SOFTARQ_DIR_DOCUMENTOS debe ser una ruta absoluta.",
    }),
  API_REGISTRO: z
    .enum(["completo", "errores", "ninguno"], { error: "API_REGISTRO: completo | errores | ninguno." })
    .optional()
    .transform((v) => v ?? "completo"),
});

export interface ConfiguracionApi {
  databaseUrl: string;
  /** `local`: HTTP en loopback. `nube`: HTTPS detrás del proxy de la plataforma. */
  despliegue: "local" | "nube";
  /** Cookie de sesión con `Secure` (solo en la nube; en local no hay TLS). */
  cookieSegura: boolean;
  /** Saltos de proxy de confianza para `req.ip` (0 en local, 1 en la nube). */
  confiarProxy: number;
  /** HSTS solo cuando hay HTTPS. */
  hsts: boolean;
  /** Carpeta del panel compilado servido por la API (mismo origen); `null` si no se sirve. */
  dirWeb: string | null;
  host: string;
  puerto: number;
  origenesCors: string[];
  /** Panel del equipo (por omisión, el primer origen permitido). */
  panelUrl: string;
  limiteGeneralPorMinuto: number;
  limiteCalculoPorMinuto: number;
  limiteCuerpoKb: number;
  accesos: {
    ventanaMs: number;
    fallosPorCuentaEIp: number;
    fallosPorCuenta: number;
    intentosPorIp: number;
  };
  zonaHoraria: string;
  /** Carpeta persistente de documentos emitidos; `null` = emisión no disponible (solo pruebas). */
  dirDocumentos: string | null;
  registro: "completo" | "errores" | "ninguno";
}

export class ErrorConfiguracion extends Error {
  constructor(readonly problemas: string[]) {
    super(`Configuración inválida de la API:\n${problemas.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ErrorConfiguracion";
  }
}

interface Resuelto {
  host: string;
  puerto: number;
  origenes: string[];
  panel: string;
}

function resolverDespliegue(e: z.infer<typeof EsquemaEntorno>): Resuelto {
  const problemas: string[] = [];
  const nube = e.SOFTARQ_DESPLIEGUE === "nube";
  const baseUrl = URL.canParse(e.DATABASE_URL) ? new URL(e.DATABASE_URL) : null;
  if (baseUrl) {
    const permitido = nube
      ? baseUrl.hostname.endsWith(".railway.internal") || HOSTS_LOCALES.has(baseUrl.hostname)
      : HOSTS_LOCALES.has(baseUrl.hostname);
    if (!permitido) {
      problemas.push(
        nube
          ? "DATABASE_URL debe apuntar a la red privada de la plataforma (*.railway.internal)."
          : "DATABASE_URL debe apuntar a PostgreSQL local.",
      );
    }
  }
  if (!nube && e.NODE_ENV === "production") {
    problemas.push("NODE_ENV=production solo se admite con SOFTARQ_DESPLIEGUE=nube (HTTPS y cookie Secure; ADR-0025).");
  }
  if (nube && e.NODE_ENV !== "production") problemas.push("SOFTARQ_DESPLIEGUE=nube exige NODE_ENV=production.");

  const host = e.API_HOST ?? (nube ? "0.0.0.0" : "127.0.0.1");
  if (!nube && host !== "127.0.0.1") problemas.push("API_HOST solo puede ser 127.0.0.1 en local (sin acceso desde la red).");
  if (nube && host !== "0.0.0.0") problemas.push("API_HOST en la nube debe ser 0.0.0.0 (la plataforma enruta por su proxy).");
  const puerto = nube ? e.PORT || e.API_PORT || 3000 : e.API_PORT || 3000;
  if (!nube && puerto < 1024) problemas.push("API_PORT mínimo 1024.");

  let origenes: string[] = [];
  let panel = "";
  if (nube) {
    const publico = e.API_PUBLIC_URL;
    if (!publico || !ORIGEN_HTTPS.test(publico)) {
      problemas.push("API_PUBLIC_URL debe ser el origen público https://host (sin ruta ni puerto).");
    } else {
      origenes = [publico];
      panel = e.API_PANEL_URL ?? publico;
      if (!ORIGEN_HTTPS.test(panel)) problemas.push("API_PANEL_URL debe ser un origen https.");
    }
    if (e.API_CORS_ORIGINS !== undefined && e.API_CORS_ORIGINS.trim() !== "") {
      problemas.push("API_CORS_ORIGINS no se usa en la nube: el panel y la API comparten origen y la app móvil no usa CORS.");
    }
  } else {
    origenes = (e.API_CORS_ORIGINS ?? "http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
    if (origenes.length < 1 || origenes.length > 10 || origenes.some((o) => o === "*" || !ORIGEN_LOCAL.test(o))) {
      problemas.push('API_CORS_ORIGINS solo admite orígenes locales explícitos por http (http://localhost:PUERTO); nunca "*".');
    }
    if (e.API_PUBLIC_URL !== undefined) problemas.push("API_PUBLIC_URL solo se usa con SOFTARQ_DESPLIEGUE=nube.");
    panel = e.API_PANEL_URL ?? origenes[0] ?? "";
    if (e.API_PANEL_URL !== undefined && !ORIGEN_LOCAL.test(e.API_PANEL_URL)) {
      problemas.push("API_PANEL_URL debe ser un origen local http://localhost:PUERTO.");
    }
  }
  if (e.SOFTARQ_DIR_WEB !== undefined && !RUTA_ABSOLUTA.test(e.SOFTARQ_DIR_WEB)) {
    problemas.push("SOFTARQ_DIR_WEB debe ser una ruta absoluta.");
  }
  if (problemas.length) throw new ErrorConfiguracion(problemas);
  return { host, puerto, origenes, panel };
}

/** Valida variables de entorno (o un objeto equivalente en pruebas). Lanza ErrorConfiguracion. */
export function leerConfiguracion(entorno: Record<string, string | undefined>): ConfiguracionApi {
  const r = EsquemaEntorno.safeParse(entorno);
  if (!r.success) {
    // Solo mensajes de las reglas; nunca los valores recibidos.
    throw new ErrorConfiguracion(r.error.issues.map((i) => i.message));
  }
  const e = r.data;
  const d = resolverDespliegue(e);
  const nube = e.SOFTARQ_DESPLIEGUE === "nube";
  return {
    databaseUrl: e.DATABASE_URL,
    despliegue: e.SOFTARQ_DESPLIEGUE,
    cookieSegura: nube,
    confiarProxy: nube ? 1 : 0,
    hsts: nube,
    dirWeb: e.SOFTARQ_DIR_WEB ?? null,
    host: d.host,
    puerto: d.puerto,
    origenesCors: d.origenes,
    panelUrl: d.panel,
    limiteGeneralPorMinuto: e.API_LIMITE_GENERAL_POR_MINUTO,
    limiteCalculoPorMinuto: e.API_LIMITE_CALCULO_POR_MINUTO,
    limiteCuerpoKb: e.API_LIMITE_CUERPO_KB,
    accesos: {
      ventanaMs: e.API_ACCESO_VENTANA_MINUTOS * 60_000,
      fallosPorCuentaEIp: e.API_ACCESO_FALLOS_CUENTA_IP,
      fallosPorCuenta: e.API_ACCESO_FALLOS_CUENTA,
      intentosPorIp: e.API_ACCESO_INTENTOS_IP,
    },
    zonaHoraria: e.SOFTARQ_ZONA_HORARIA,
    dirDocumentos: e.SOFTARQ_DIR_DOCUMENTOS ?? null,
    registro: e.API_REGISTRO,
  };
}
