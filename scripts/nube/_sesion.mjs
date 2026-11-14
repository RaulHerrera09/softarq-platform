// Utilidades compartidas de los scripts en línea: sesión del equipo (cookie + CSRF) y lectura de las credenciales locales.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const API = process.env.SOFTARQ_API ?? "https://softarq-production.up.railway.app";
export const secretos = () => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "..", "_work", "secrets", "nube-railway.json"), "utf8"));

export class Equipo {
  cookie = null;
  csrf = null;
  async pedir(metodo, ruta, cuerpo, binario = false) {
    const h = { Origin: API };
    if (this.cookie) h.Cookie = `softarq_sesion=${this.cookie}`;
    if (metodo !== "GET") { if (this.csrf) h["X-CSRF-Token"] = this.csrf; h["Idempotency-Key"] = randomUUID(); }
    if (cuerpo !== undefined) h["Content-Type"] = "application/json";
    const r = await fetch(`${API}${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const set = r.headers.getSetCookie().find((c) => c.startsWith("softarq_sesion="));
    if (set) this.cookie = set.slice(15).split(";")[0] || null;
    if (binario) return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) };
    const t = await r.text();
    let c = null;
    try { c = t ? JSON.parse(t) : null; } catch { c = t; }
    return { status: r.status, cuerpo: c, texto: t };
  }
  get = (r) => this.pedir("GET", r);
  post = (r, c) => this.pedir("POST", r, c);
  put = (r, c) => this.pedir("PUT", r, c);
  patch = (r, c) => this.pedir("PATCH", r, c);
  async entrar(correo, contrasena) {
    this.csrf = (await this.pedir("GET", "/api/v1/auth/csrf")).cuerpo.csrfToken;
    const r = await this.pedir("POST", "/api/v1/auth/sesion", { correo, contrasena });
    if (r.status !== 200) throw new Error(`Acceso fallido (${r.status})`);
    this.csrf = r.cuerpo.csrfToken;
    return this;
  }
}
export const exigir = (r, esperado, que) => {
  if (!esperado.includes(r.status)) throw new Error(`${que}: ${r.status} ${(r.texto ?? "").slice(0, 300)}`);
  return r.cuerpo;
};
export async function equipo(rol = "preparador") {
  const s = secretos();
  const correo = { preparador: "preparador.demo@softarq.test", revisor: "revisor.demo@softarq.test", admin: "administrador.demo@softarq.test" }[rol];
  return new Equipo().entrar(correo, s.cuentas[correo].contrasena);
}
