#!/usr/bin/env node
// Ejemplos completos de presentación por tipo de trabajo, por las rutas normales de la API (idempotente):
//   · se completan las solicitudes existentes SOL-2026-00001 (muro) y SOL-2026-00002 (losa) de Laura Méndez;
//   · Héctor (cubierta, «Nave industrial Querétaro») y Silvia (muro, «Casa Coyoacán») envían una solicitud cada uno desde su cuenta.
// Cada una recorre: atención → precios elegidos de forma explícita → cálculo → revisión por OTRA persona → emisión.
// Con COT-2026-00056 (losa de Raul) y COT-2026-00055 (cubierta de Laura) quedan dos ejemplos por tipo.
import { randomUUID } from "node:crypto";
import { API, equipo, exigir, secretos } from "./_sesion.mjs";

class Cliente {
  token = null;
  async pedir(metodo, ruta, cuerpo) {
    const h = {};
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (cuerpo !== undefined) h["Content-Type"] = "application/json";
    const r = await fetch(`${API}${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const t = await r.text();
    let c = null;
    try { c = t ? JSON.parse(t) : null; } catch { c = t; }
    return { status: r.status, cuerpo: c, texto: t };
  }
  get = (r) => this.pedir("GET", r);
  post = (r, c) => this.pedir("POST", r, c);
  async entrar(correo, contrasena) {
    const r = await this.pedir("POST", "/api/v1/auth/movil/sesion", { correo, contrasena });
    if (r.status !== 200) throw new Error(`Acceso móvil fallido (${r.status})`);
    this.token = r.cuerpo.tokenSesion;
    return this;
  }
}
const paso = (m) => console.log(`• ${m}`);
const prep = await equipo("preparador");
const rev = await equipo("revisor");

/** Atención → precios explícitos → cálculo → revisión por otra persona → emisión. Reconoce lo ya hecho. */
async function completar(folio) {
  const lista = exigir(await prep.get("/api/v1/solicitudes?estado=ENVIADA,EN_PREPARACION,COTIZADA"), [200], "Bandeja");
  const fila = lista.solicitudes.find((s) => s.folio === folio);
  if (!fila) throw new Error(`No encontré ${folio}.`);
  const sol = exigir(await prep.get(`/api/v1/solicitudes/${fila.id}`), [200], "Detalle");
  if (sol.estado === "COTIZADA" && sol.cotizacionId) return paso(`${folio}: ya cotizada`);
  let cotId = sol.cotizacionId;
  if (!cotId) cotId = exigir(await prep.post(`/api/v1/solicitudes/${fila.id}/atencion`, { revision: sol.revision }), [200, 201], "Atender").cotizacionId;
  let cot = exigir(await prep.get(`/api/v1/cotizaciones/${cotId}`), [200], "Cotización");
  if (!cot.versiones?.length) {
    const codigos = cot.borrador.captura.partidas.filter((p) => p.tipo === "CONCEPTO").map((p) => p.conceptoCodigo);
    const op = exigir(await prep.get(`/api/v1/catalogos/opciones-precio?conceptos=${codigos.join(",")}`), [200], "Opciones de precio");
    const seleccion = op.insumos.map((x) => ({ insumoCodigo: x.insumoCodigo, precioCodigo: (x.opciones.find((o) => o.esMenorPrecio) ?? x.opciones[0]).precioCodigo }));
    const g = exigir(await prep.put(`/api/v1/cotizaciones/${cotId}/borrador`, { revision: cot.borrador.revision, captura: { ...cot.borrador.captura, consolidarCompras: true, seleccion } }), [200], "Guardar borrador");
    exigir(await prep.post(`/api/v1/cotizaciones/${cotId}/versiones`, { revisionBorrador: g.revision }), [201], "Calcular");
    cot = exigir(await prep.get(`/api/v1/cotizaciones/${cotId}`), [200], "Detalle");
  }
  const ult = cot.versiones.at(-1);
  let revisionId = ult.revisionVigente?.id;
  if (ult.estado === "BORRADOR") {
    const e = exigir(await prep.post(`/api/v1/cotizaciones/${cotId}/versiones/${ult.numero}/revisiones`, { revisionBorrador: cot.borrador.revision }), [201], "Enviar a revisión");
    revisionId = e.revision.id;
    exigir(await rev.post(`/api/v1/revisiones/${revisionId}/decision`, { decision: "APROBAR", versionId: e.revision.version.id, revision: e.revision.revision }), [200], "Aprobar");
    cot = exigir(await prep.get(`/api/v1/cotizaciones/${cotId}`), [200], "Detalle");
  }
  const u2 = cot.versiones.at(-1);
  if (!u2.emision) exigir(await prep.post(`/api/v1/cotizaciones/${cotId}/versiones/${ult.numero}/emision`, { versionId: u2.id, revisionId: revisionId ?? u2.revisionVigente?.id }), [201], "Emitir");
  paso(`${folio} → ${cot.cotizacion.folio}: total ${u2.total}, emitida`);
}

const S = secretos().cuentas;
const credencial = (nombre) => {
  const e = Object.entries(S).find(([, v]) => v.nombre === nombre);
  if (!e) throw new Error(`Sin credencial de ${nombre}.`);
  return { correo: e[0], contrasena: e[1].contrasena };
};
async function enviarDesde(nombre, proyecto, trabajo, nota) {
  const c = await new Cliente().entrar(credencial(nombre).correo, credencial(nombre).contrasena);
  const previas = exigir(await c.get("/api/v1/cliente/solicitudes"), [200], "Mis solicitudes").solicitudes;
  let ya = null;
  for (const x of previas) if (exigir(await c.get(`/api/v1/cliente/solicitudes/${x.id}`), [200], "Detalle").captura?.notas === nota) ya = x;
  if (ya) return paso(`${nombre}: ya envió ${ya.folio}`), ya.folio;
  const proy = exigir(await c.get("/api/v1/cliente/proyectos"), [200], "Proyectos").proyectos.find((p) => p.nombre === proyecto);
  if (!proy) throw new Error(`${nombre} no tiene el proyecto ${proyecto}.`);
  let sol = exigir(await c.post("/api/v1/cliente/solicitudes", { proyectoId: proy.id, captura: { trabajos: [trabajo], notas: nota } }), [200, 201], "Crear solicitud");
  exigir(await c.post(`/api/v1/cliente/solicitudes/${sol.id}/estimaciones`, { revision: sol.revision }), [200, 201], "Estimar");
  sol = exigir(await c.get(`/api/v1/cliente/solicitudes/${sol.id}`), [200], "Detalle");
  exigir(await c.post(`/api/v1/cliente/solicitudes/${sol.id}/envio`, { revision: sol.revision }), [200, 201], "Enviar");
  paso(`${nombre}: envió ${sol.folio} (${nota})`);
  return sol.folio;
}

await completar("SOL-2026-00001");
await completar("SOL-2026-00002");
const cubierta = await enviarDesde("Héctor Ríos", "Nave industrial Querétaro", { id: "t1", trabajoCodigo: "CUBIERTA", opcionCodigo: "LAMINA", secciones: [{ nombre: "Faldón norte", piezas: "1", largo: "10", ancho: "4.5", alto: null }, { nombre: "Faldón sur", piezas: "1", largo: "10", ancho: "4.5", alto: null }], huecos: [] }, "Ejemplo de presentación: cubierta");
await completar(cubierta);
const muro = await enviarDesde("Silvia Aranda", "Casa Coyoacán", { id: "t1", trabajoCodigo: "MURO", opcionCodigo: "BLOCK", secciones: [{ nombre: "Colindancia", piezas: "1", largo: "9", ancho: null, alto: "2.4" }], huecos: [{ nombre: "Ventana", piezas: "2", largo: "1.2", ancho: null, alto: "1" }] }, "Ejemplo de presentación: muro");
await completar(muro);
void randomUUID;
