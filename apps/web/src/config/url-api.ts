/**
 * Validación de la URL pública de la API (VITE_API_URL). La usan `vite.config.ts` (falla la
 * compilación o el arranque) y la aplicación en ejecución. Sin dependencias del navegador.
 *
 * Se admite la API local (http sobre `localhost`, con puerto) o, en la nube, el origen https público
 * (mismo origen que el panel). Sin ruta, credenciales, consulta ni fragmento. Nunca contiene secretos.
 *
 * Por qué `localhost` y no `127.0.0.1` (ADR-0007): la web se abre en http://localhost:5173 y la
 * cookie de sesión es `SameSite=Strict` y host-only. Con la API en 127.0.0.1 serían *sites*
 * distintos y el navegador no enviaría la cookie. La API sigue escuchando solo en 127.0.0.1.
 */
export const URL_API_POR_OMISION = "http://localhost:3000";

/**
 * Despliegue en la nube (ADR-0025): el panel y la API comparten origen https público. Solo un nombre
 * de dominio (no una IP ni localhost), sin puerto, credenciales, ruta, consulta ni fragmento.
 */
function validarHttps(url: URL): ResultadoUrlApi {
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(":");
  if (url.hostname === "localhost" || ip || !url.hostname.includes(".")) {
    return { ok: false, motivo: "VITE_API_URL con https debe ser un dominio público; localhost y las IP usan http." };
  }
  if (url.username || url.password) return { ok: false, motivo: "VITE_API_URL no puede llevar credenciales." };
  if (url.port || url.pathname !== "/" || url.search || url.hash) {
    return { ok: false, motivo: "VITE_API_URL con https debe ser solo el origen, sin puerto, ruta ni consulta." };
  }
  return { ok: true, url: url.origin };
}

export type ResultadoUrlApi = { ok: true; url: string } | { ok: false; motivo: string };

export function validarUrlApi(valor: string | undefined): ResultadoUrlApi {
  const texto = (valor ?? "").trim() || URL_API_POR_OMISION;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, motivo: "VITE_API_URL no es una URL válida." };
  }
  if (url.protocol === "https:") return validarHttps(url);
  if (url.protocol !== "http:") return { ok: false, motivo: "VITE_API_URL debe usar http (API local) o https (despliegue en la nube)." };
  if (url.hostname !== "localhost") {
    return {
      ok: false,
      motivo: "VITE_API_URL debe usar el host localhost (el mismo site que la web, para la cookie de sesión).",
    };
  }
  if (url.username || url.password) return { ok: false, motivo: "VITE_API_URL no puede llevar credenciales." };
  if (url.pathname !== "/" || url.search || url.hash) {
    return { ok: false, motivo: "VITE_API_URL debe ser solo el origen, sin ruta ni consulta." };
  }
  if (!url.port) return { ok: false, motivo: "VITE_API_URL debe indicar el puerto." };
  return { ok: true, url: url.origin };
}
