#!/usr/bin/env node
// Recorrido de verificación del entorno en línea por las rutas normales (HTTPS, sin SQL):
//   cliente QA → solicitud → estimación → envío → atención del equipo → precios explícitos → cálculo →
//   revisión por otra persona → emisión → consulta y descarga del PDF por el cliente.
// Además: aislamiento entre cliente y equipo, datos de presentación de Raul (COT-2026-00056 y su PDF por SHA-256),
// exportaciones y estado de la API. Las credenciales salen de _work/secrets/nube-railway.json (nunca se imprimen).
//
// Uso (raíz del repositorio):  node scripts/nube/recorrido-nube.mjs https://<dominio> [--hash-raul <sha256 del PDF original>]
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const API = (args[0] ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(API)) throw new Error("Indique el origen https de la API.");
const i = args.indexOf("--hash-raul");
const HASH_RAUL = i >= 0 ? args[i + 1] : null;
const secretos = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "..", "_work", "secrets", "nube-railway.json"), "utf8"));
const porNombre = (n) => Object.entries(secretos.cuentas).find(([, v]) => v.nombre === n);
const resultados = [];
const ok = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) process.exitCode = 1;
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const leer = async (r) => {
  const t = await r.text();
  try { return { status: r.status, cuerpo: t ? JSON.parse(t) : null, texto: t, headers: r.headers }; } catch { return { status: r.status, cuerpo: null, texto: t, headers: r.headers }; }
};

class Equipo {
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
    if (binario) return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers };
    return leer(r);
  }
  get = (r) => this.pedir("GET", r);
  post = (r, c) => this.pedir("POST", r, c);
  put = (r, c) => this.pedir("PUT", r, c);
  async entrar(correo, contrasena) {
    this.csrf = (await this.pedir("GET", "/api/v1/auth/csrf")).cuerpo.csrfToken;
    const r = await this.pedir("POST", "/api/v1/auth/sesion", { correo, contrasena });
    if (r.status !== 200) throw new Error(`Acceso fallido (${r.status})`);
    this.csrf = r.cuerpo.csrfToken;
    return this;
  }
}
class Cliente {
  token = null;
  async pedir(metodo, ruta, cuerpo, binario = false) {
    const h = {};
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (cuerpo !== undefined) h["Content-Type"] = "application/json";
    const r = await fetch(`${API}${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    if (binario) return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers };
    return leer(r);
  }
  get = (r) => this.pedir("GET", r);
  post = (r, c) => this.pedir("POST", r, c);
  put = (r, c) => this.pedir("PUT", r, c);
  async entrar(correo, contrasena) {
    const r = await this.pedir("POST", "/api/v1/auth/movil/sesion", { correo, contrasena });
    if (r.status !== 200) throw new Error(`Acceso móvil fallido (${r.status}) ${r.cuerpo?.error?.codigo ?? ""}`);
    this.token = r.cuerpo.tokenSesion;
    return r;
  }
}
const exigir = (r, esperado, que) => {
  if (!esperado.includes(r.status)) throw new Error(`${que}: ${r.status} ${(r.texto ?? "").slice(0, 300)}`);
  return r.cuerpo;
};

// 0. Estado, HTTPS y panel
const h = await fetch(`${API}/health`);
ok("healthcheck", h.status === 200 && (await h.json()).baseDeDatos === "disponible");
ok("HSTS y panel compilado", h.headers.get("strict-transport-security") !== null && (await (await fetch(API)).text()).includes("/assets/index-"));

const [correoPrep, credPrep] = ["preparador.demo@softarq.test", secretos.cuentas["preparador.demo@softarq.test"].contrasena];
const [correoRev, credRev] = ["revisor.demo@softarq.test", secretos.cuentas["revisor.demo@softarq.test"].contrasena];
const [correoAdm, credAdm] = ["administrador.demo@softarq.test", secretos.cuentas["administrador.demo@softarq.test"].contrasena];
const [correoQa, datosQa] = porNombre("Pruebas QA");

const prep = await new Equipo().entrar(correoPrep, credPrep);
const rev = await new Equipo().entrar(correoRev, credRev);
const adm = await new Equipo().entrar(correoAdm, credAdm);
ok("acceso del equipo (Preparador, Revisor y Administrador)", true);
const cookieSesion = (await fetch(`${API}/api/v1/auth/csrf`)).headers.get("set-cookie") ?? "";
ok("cookie de sesión con HttpOnly, Secure y SameSite=Strict", /HttpOnly/.test(cookieSesion) && /Secure/.test(cookieSesion) && /SameSite=Strict/.test(cookieSesion));
ok("origen ajeno rechazado", (await fetch(`${API}/api/v1/auth/sesion`, { method: "POST", headers: { Origin: "https://malo.example", "Content-Type": "application/json" }, body: "{}" })).status === 403);

// 1. Cliente QA: solicitud, estimación y envío
const qa = new Cliente();
await qa.entrar(correoQa, datosQa.contrasena);
const proyectos = exigir(await qa.get("/api/v1/cliente/proyectos"), [200], "Proyectos").proyectos;
const proyecto = proyectos[0];
const captura = { trabajos: [{ id: "t1", trabajoCodigo: "LOSA", opcionCodigo: "CONCRETO", secciones: [{ nombre: "Sección 1", piezas: "1", largo: "6", ancho: "5", alto: "0.12" }], huecos: [] }], notas: "[QA] recorrido en línea" };
let sol = exigir(await qa.post("/api/v1/cliente/solicitudes", { proyectoId: proyecto.id, captura }), [200, 201], "Crear solicitud");
const est = exigir(await qa.post(`/api/v1/cliente/solicitudes/${sol.id}/estimaciones`, { revision: sol.revision }), [200, 201], "Estimar");
const estSol = exigir(await qa.get(`/api/v1/cliente/solicitudes/${sol.id}`), [200], "Detalle");
ok("estimación preliminar calculada por la API", estSol.ultimaEstimacion != null, `folio ${sol.folio ?? estSol.folio}`);
const env = exigir(await qa.post(`/api/v1/cliente/solicitudes/${sol.id}/envio`, { revision: estSol.revision }), [200, 201], "Enviar");
sol = exigir(await qa.get(`/api/v1/cliente/solicitudes/${sol.id}`), [200], "Detalle tras enviar");
ok("solicitud enviada", sol.estado === "ENVIADA", sol.folio);

// 2. Equipo: atención, precios explícitos, cálculo, revisión, emisión
const lista = exigir(await prep.get("/api/v1/solicitudes?estado=ENVIADA"), [200], "Bandeja");
const fila = (lista.solicitudes ?? lista.elementos ?? []).find((s) => s.folio === sol.folio);
ok("la solicitud aparece en la bandeja del equipo", !!fila);
const det = exigir(await prep.get(`/api/v1/solicitudes/${fila.id}`), [200], "Detalle del equipo");
const at = exigir(await prep.post(`/api/v1/solicitudes/${fila.id}/atencion`, { revision: det.revision }), [200, 201], "Atender");
let cot = exigir(await prep.get(`/api/v1/cotizaciones/${at.cotizacionId}`), [200], "Cotización");
const codigos = cot.borrador.captura.partidas.filter((p) => p.tipo === "CONCEPTO").map((p) => p.conceptoCodigo);
const op = exigir(await prep.get(`/api/v1/catalogos/opciones-precio?conceptos=${codigos.join(",")}`), [200], "Opciones de precio");
const seleccion = op.insumos.map((x) => ({ insumoCodigo: x.insumoCodigo, precioCodigo: (x.opciones.find((o) => o.esMenorPrecio) ?? x.opciones[0]).precioCodigo }));
const g = exigir(await prep.put(`/api/v1/cotizaciones/${at.cotizacionId}/borrador`, { revision: cot.borrador.revision, captura: { ...cot.borrador.captura, consolidarCompras: true, seleccion } }), [200], "Guardar borrador");
ok("precios elegidos de forma explícita y borrador completo", g.completitud?.completo !== false, seleccion.map((s) => s.precioCodigo).join(", "));
const v = exigir(await prep.post(`/api/v1/cotizaciones/${at.cotizacionId}/versiones`, { revisionBorrador: g.revision }), [201], "Calcular");
ok("versión calculada por el servidor", !!v.version?.total, `total ${v.version.total}`);
cot = exigir(await prep.get(`/api/v1/cotizaciones/${at.cotizacionId}`), [200], "Detalle");
const ult = cot.versiones.at(-1);
const e = exigir(await prep.post(`/api/v1/cotizaciones/${at.cotizacionId}/versiones/${ult.numero}/revisiones`, { revisionBorrador: cot.borrador.revision }), [201], "Enviar a revisión");
const propia = await prep.post(`/api/v1/revisiones/${e.revision.id}/decision`, { decision: "APROBAR", versionId: e.revision.version.id, revision: e.revision.revision });
ok("el Preparador no puede aprobar su propia versión (BL-17)", [403, 409, 422].includes(propia.status), `HTTP ${propia.status}`);
const d = exigir(await rev.post(`/api/v1/revisiones/${e.revision.id}/decision`, { decision: "APROBAR", versionId: e.revision.version.id, revision: e.revision.revision }), [200], "Aprobar");
ok("aprobación por otra persona", d.revision?.estado === "APROBADA" || d.revision?.estado === undefined, d.revision?.estado);
cot = exigir(await prep.get(`/api/v1/cotizaciones/${at.cotizacionId}`), [200], "Detalle tras aprobar");
const u2 = cot.versiones.at(-1);
const emitir = () => prep.post(`/api/v1/cotizaciones/${at.cotizacionId}/versiones/${ult.numero}/emision`, { versionId: u2.id, revisionId: e.revision.id });
let r = await emitir();
const sinContacto = r.status === 422 && r.cuerpo?.error?.problemas?.find((x) => x.codigo === "BL-01");
if (sinContacto) {
  const cli = exigir(await prep.get("/api/v1/clientes"), [200], "Clientes");
  const c = (cli.clientes ?? cli.elementos ?? []).find((x) => x.codigo === sinContacto.referencia);
  exigir(await prep.pedir("PATCH", `/api/v1/clientes/${c.id}`, { revision: c.revision, contactoCorreo: correoQa }), [200], "Contacto del cliente QA");
  r = await emitir();
}
const em = exigir(r, [201], "Emitir");
ok("emisión", !!em, "PDF registrado con su SHA-256");

// 3. El cliente consulta y descarga
const cots = exigir(await qa.get("/api/v1/cliente/cotizaciones"), [200], "Cotizaciones del cliente").cotizaciones;
const suya = cots.find((c) => c.solicitudFolio === sol.folio);
ok("el cliente ve su cotización emitida", !!suya, suya?.folio);
const pdf = await qa.pedir("GET", `/api/v1/cliente/cotizaciones/${suya.emisionId}/documento`, undefined, true);
if (pdf.status !== 200) console.log("  respuesta:", pdf.status, pdf.bytes.toString().slice(0, 200));
ok("el cliente descarga el PDF emitido", pdf.status === 200 && pdf.bytes.subarray(0, 5).toString() === "%PDF-", `${pdf.bytes.length} bytes`);
const detCot = exigir(await prep.get(`/api/v1/cotizaciones/${at.cotizacionId}`), [200], "Detalle");
const shaRegistrado = detCot.versiones.at(-1).emision?.archivo?.sha256;
ok("los bytes descargados coinciden con el SHA-256 registrado", !!shaRegistrado && sha(pdf.bytes) === shaRegistrado);

// 4. Aislamiento
const todas = exigir(await prep.get("/api/v1/cotizaciones?buscar=COT-2026-00056"), [200], "Buscar COT-2026-00056");
const raul = (todas.cotizaciones ?? todas.elementos ?? []).find((c) => c.folio === "COT-2026-00056");
ok("COT-2026-00056 de Raul conservada", !!raul);
if (raul) {
  const ajena = await qa.get(`/api/v1/cliente/cotizaciones/${raul.id}`);
  ok("un cliente no ve la cotización de otro cliente", [403, 404].includes(ajena.status), `HTTP ${ajena.status}`);
  const detRaul = exigir(await prep.get(`/api/v1/cotizaciones/${raul.id}`), [200], "Detalle de Raul");
  const emRaul = detRaul.versiones.at(-1).emision;
  const idEm = emRaul?.id;
  const pdfRaul = await prep.pedir("GET", `/api/v1/emisiones/${idEm}/documento`, undefined, true);
  const shaRaul = sha(pdfRaul.bytes);
  ok("PDF de COT-2026-00056 con el SHA-256 registrado", pdfRaul.status === 200 && shaRaul === emRaul.archivo?.sha256, `${pdfRaul.bytes.length} bytes, ${shaRaul.slice(0, 12)}…`);
  if (HASH_RAUL) ok("PDF de Raul idéntico al original local", shaRaul === HASH_RAUL);
}
ok("el cliente no accede a rutas del equipo", [401, 403].includes((await qa.get("/api/v1/cotizaciones")).status));
const cuentaEquipoMovil = await new Cliente().entrar(correoPrep, credPrep).then(() => 200, (x) => (/403/.test(x.message) ? 403 : 0));
ok("una cuenta del equipo no entra a la app (403)", cuentaEquipoMovil === 403);
ok("el Preparador no accede a Administración (403)", (await prep.get("/api/v1/admin/proveedores")).status === 403);
ok("el Administrador del catálogo accede a su sección", (await adm.get("/api/v1/admin/proveedores")).status === 200);

// 5. Exportaciones
const ex = await adm.get("/api/v1/exportaciones");
const tablas = ex.cuerpo?.tablas ?? [];
ok("exportaciones disponibles para el administrador", ex.status === 200 && tablas.length > 0, `${tablas.length} tablas`);
const csv = await adm.pedir("GET", `/api/v1/exportaciones/${tablas[0]?.id ?? tablas[0]?.nombre ?? "clientes"}`, undefined, true);
ok("exportación CSV", csv.status === 200 && csv.bytes.length > 0, `${csv.bytes.length} bytes`);

console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} comprobaciones correctas.`);
