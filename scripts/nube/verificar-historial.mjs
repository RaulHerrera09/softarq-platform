#!/usr/bin/env node
// Verificación breve del historial y de la vista de presentación en línea, sin tocar las cuentas de presentación:
//  · varias solicitudes de un cliente de presentación se conservan, se ven una a una y llegan a la bandeja del equipo con la vista limpia;
//  · cada cliente solo ve lo suyo; los contadores corresponden al alcance mostrado;
//  · una cotización emitida muestra su historial (revisión, aprobación, emisión, eventos) y su seguimiento.
// Usa la cuenta de Silvia Aranda (cliente de presentación de ejemplo) y retira las solicitudes de verificación al terminar.
import { API, equipo, exigir, secretos } from "./_sesion.mjs";

const ok = (n, c, d = "") => { console.log(`${c ? "OK   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); if (!c) process.exitCode = 1; };
const S = secretos().cuentas;
const cred = (nombre) => Object.entries(S).find(([, v]) => v.nombre === nombre);
async function movil(nombre) {
  const [correo, v] = cred(nombre);
  const r = await fetch(`${API}/api/v1/auth/movil/sesion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo, contrasena: v.contrasena }) });
  const token = (await r.json()).tokenSesion;
  const f = async (m, ruta, cuerpo) => {
    const x = await fetch(`${API}${ruta}`, { method: m, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const t = await x.text();
    return { status: x.status, cuerpo: t ? JSON.parse(t) : null };
  };
  return f;
}
const prep = await equipo("preparador");
const silvia = await movil("Silvia Aranda");
const hector = await movil("Héctor Ríos");

const base = exigir(await prep.get("/api/v1/solicitudes?estado=ENVIADA&clasificacion=PRESENTACION"), [200], "Bandeja").solicitudes.length;
const proyecto = exigir(await silvia("GET", "/api/v1/cliente/proyectos"), [200], "Proyectos").proyectos.find((p) => p.nombre === "Casa Coyoacán");
const creadas = [];
for (const [i, largo] of ["4", "5", "6"].entries()) {
  const captura = { trabajos: [{ id: "t1", trabajoCodigo: "LOSA", opcionCodigo: "CONCRETO", secciones: [{ nombre: "Sección 1", piezas: "1", largo, ancho: "3", alto: "0.1" }], huecos: [] }], notas: `[QA] verificación de historial ${i + 1}` };
  let s = exigir(await silvia("POST", "/api/v1/cliente/solicitudes", { proyectoId: proyecto.id, captura }), [200, 201], "Crear");
  exigir(await silvia("POST", `/api/v1/cliente/solicitudes/${s.id}/estimaciones`, { revision: s.revision }), [200, 201], "Estimar");
  s = exigir(await silvia("GET", `/api/v1/cliente/solicitudes/${s.id}`), [200], "Detalle");
  exigir(await silvia("POST", `/api/v1/cliente/solicitudes/${s.id}/envio`, { revision: s.revision }), [200, 201], "Enviar");
  creadas.push(s);
}
const propias = exigir(await silvia("GET", "/api/v1/cliente/solicitudes"), [200], "Mis solicitudes").solicitudes;
ok("las tres solicitudes se conservan y se siguen una a una (folios distintos)", creadas.every((c) => propias.some((p) => p.folio === c.folio)) && new Set(creadas.map((c) => c.folio)).size === 3, creadas.map((c) => c.folio.slice(-5)).join(", "));
const det = exigir(await silvia("GET", `/api/v1/cliente/solicitudes/${creadas[1].id}`), [200], "Detalle individual");
ok("cada solicitud muestra obra, trabajos, medidas, estimación y fecha", !!det.proyecto?.nombre && det.captura.trabajos[0].secciones[0].largo === "5" && !!det.ultimaEstimacion && !!det.enviadaEn);
const bandeja = exigir(await prep.get("/api/v1/solicitudes?estado=ENVIADA&clasificacion=PRESENTACION"), [200], "Bandeja").solicitudes;
ok("la vista de presentación NO oculta las solicitudes nuevas del cliente de presentación", bandeja.length === base + 3, `${base} → ${bandeja.length}`);
const contadoresP = exigir(await prep.get("/api/v1/cotizaciones/contadores?clasificacion=PRESENTACION"), [200], "Contadores");
const contadoresT = exigir(await prep.get("/api/v1/cotizaciones/contadores"), [200], "Contadores");
ok("los contadores de la vista de presentación son menores que los del historial completo", contadoresP.emitidasVigentes < contadoresT.emitidasVigentes || contadoresP.borradores < contadoresT.borradores, `emitidas ${contadoresP.emitidasVigentes}/${contadoresT.emitidasVigentes}, borradores ${contadoresP.borradores}/${contadoresT.borradores}`);
const ajenas = exigir(await hector("GET", "/api/v1/cliente/solicitudes"), [200], "Solicitudes de Héctor").solicitudes;
ok("otro cliente no ve esas solicitudes", !ajenas.some((a) => creadas.some((c) => c.folio === a.folio)));
ok("otro cliente no abre una solicitud ajena por su identificador", [403, 404].includes((await hector("GET", `/api/v1/cliente/solicitudes/${creadas[0].id}`)).status));

// Historial de una cotización emitida (ejemplo conservado)
const lista = exigir(await prep.get("/api/v1/cotizaciones?clasificacion=PRESENTACION&limite=100"), [200], "Cotizaciones").cotizaciones;
ok("la vista de presentación lista solo ejemplos de presentación", lista.length >= 6 && lista.every((c) => c.cliente.clasificacion === "PRESENTACION"), `${lista.length} cotizaciones`);
const c = exigir(await prep.get(`/api/v1/cotizaciones/${lista.find((x) => x.folio === "COT-2026-00056").id}`), [200], "Cotización de Raul");
ok("historial completo de COT-2026-00056: solicitud de origen, revisión aprobada, emisión y eventos", c.cotizacion.solicitud?.folio === "SOL-2026-00003" && c.revisiones.some((r) => r.estado === "APROBADA") && !!c.versiones.at(-1).emision && (c.eventos?.length ?? 0) >= 5, `${c.eventos?.length} eventos`);
const seg = await prep.get(`/api/v1/emisiones/${c.versiones.at(-1).emision.id}/seguimiento`);
ok("seguimiento de la emisión", seg.status === 200);

// Se retiran las solicitudes de verificación (quedan como «Retiradas» del cliente de ejemplo).
for (const s of creadas) exigir(await silvia("POST", `/api/v1/cliente/solicitudes/${s.id}/retiro`, { motivo: "Verificación de historial" }), [200, 201], "Retirar");
const final = exigir(await prep.get("/api/v1/solicitudes?estado=ENVIADA&clasificacion=PRESENTACION"), [200], "Bandeja").solicitudes.length;
ok("la bandeja de presentación vuelve a su estado limpio", final === base, `${final} por atender`);
