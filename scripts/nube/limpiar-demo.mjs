#!/usr/bin/env node
// Depuración del DEMO en línea por las operaciones admitidas de la API (sin SQL, sin tocar versiones ni emisiones):
//  · cotizaciones de clientes HUMO o QA que NO tienen emisión: se anula la aprobación vigente (si la hay, por el Revisor, con motivo)
//    y se descartan con motivo (el folio y su historial se conservan; no se reutilizan);
//  · solicitudes de la cuenta QA enviadas y sin atender: las retira la propia cuenta QA desde su acceso;
//  · todo lo demás se CONSERVA: Presentación, lo emitido (archivado fuera de la vista inicial por su clasificación), lo dudoso.
// Sin `--ejecutar` solo informa (simulacro). Uso:  node scripts/nube/limpiar-demo.mjs [--ejecutar]
import { API, equipo, exigir, secretos } from "./_sesion.mjs";

const EJECUTAR = process.argv.includes("--ejecutar");
const MOTIVO = "Depuración de pruebas para la presentación; se conserva el folio y su historial.";
const prep = await equipo("preparador");
const rev = await equipo("revisor");

const antes = exigir(await prep.get("/api/v1/cotizaciones?limite=100"), [200], "Cotizaciones").cotizaciones;
const clase = (c) => c.cliente.clasificacion;
const vista = (c) => c.ultimaVersion?.estado ?? "SIN_VERSION";
const resumen = (lista, titulo) => {
  const por = {};
  for (const c of lista) {
    const k = `${c.estadoFolio === "ACTIVO" ? "activa" : "descartada"} · ${clase(c) ?? "sin clasificar"} · ${vista(c)}`;
    por[k] = (por[k] ?? 0) + 1;
  }
  console.log(`\n${titulo} (${lista.length} cotizaciones)`);
  for (const [k, v] of Object.entries(por).sort()) console.log(`  ${String(v).padStart(3)}  ${k}`);
};
resumen(antes, "Antes");

const prescindibles = antes.filter((c) => c.estadoFolio === "ACTIVO" && ["HUMO", "QA"].includes(clase(c)) && vista(c) !== "EMITIDA" && vista(c) !== "EN_REVISION");
const dudosas = antes.filter((c) => c.estadoFolio === "ACTIVO" && ["HUMO", "QA"].includes(clase(c)) && vista(c) === "EN_REVISION");
console.log(`\nPrescindibles a descartar: ${prescindibles.length} · en revisión (se conservan): ${dudosas.length}`);
let descartadas = 0;
let anuladas = 0;
const conservadas = [];
if (EJECUTAR) {
  for (const c of prescindibles) {
    const rv = c.ultimaVersion?.revisionVigente;
    if (vista(c) === "APROBADA" && rv) {
      exigir(await rev.post(`/api/v1/revisiones/${rv.id}/anulacion`, { revision: rv.revision, motivo: MOTIVO }), [200], `Anular la aprobación de ${c.folio}`);
      anuladas++;
    }
    const r = await prep.post(`/api/v1/cotizaciones/${c.id}/descarte`, { motivo: MOTIVO });
    if (r.status === 422 && r.cuerpo?.error?.codigo === "DESCARTE_BLOQUEADO") {
      // Otra versión de la misma cotización ya se emitió: se conserva (archivada por su clasificación).
      conservadas.push(c.folio);
      continue;
    }
    exigir(r, [200], `Descartar ${c.folio}`);
    descartadas++;
  }
}

// Solicitudes de la cuenta QA enviadas y sin atender: las retira la propia cuenta.
const S = secretos().cuentas;
const [correoQa, datosQa] = Object.entries(S).find(([, v]) => v.nombre === "Pruebas QA");
const login = await fetch(`${API}/api/v1/auth/movil/sesion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo: correoQa, contrasena: datosQa.contrasena }) });
const token = (await login.json()).tokenSesion;
const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const misSol = (await (await fetch(`${API}/api/v1/cliente/solicitudes`, { headers: h })).json()).solicitudes;
const sinAtender = misSol.filter((s) => s.estado === "ENVIADA");
console.log(`Solicitudes QA enviadas sin atender: ${sinAtender.length}`);
let retiradas = 0;
if (EJECUTAR) {
  for (const s of sinAtender) {
    const r = await fetch(`${API}/api/v1/cliente/solicitudes/${s.id}/retiro`, { method: "POST", headers: h, body: JSON.stringify({ revision: s.revision }) });
    if (r.status !== 200 && r.status !== 201) throw new Error(`Retirar ${s.folio}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    retiradas++;
  }
}
if (EJECUTAR) {
  const despues = exigir(await prep.get("/api/v1/cotizaciones?limite=100"), [200], "Cotizaciones").cotizaciones;
  resumen(despues, "Después");
  console.log(`\nAprobaciones anuladas: ${anuladas} · cotizaciones descartadas: ${descartadas} · solicitudes QA retiradas: ${retiradas}`);
  if (conservadas.length) console.log(`Conservadas por tener una versión emitida (archivadas por su clasificación): ${conservadas.join(", ")}`);
} else console.log("\nSimulacro: no se cambió nada. Use --ejecutar para depurar.");
