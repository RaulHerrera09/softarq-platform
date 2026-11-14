#!/usr/bin/env node
// Cuentas de presentación del entorno en línea, por las rutas normales de la API (idempotente: reutiliza lo que ya existe).
// Crea con contraseña TEMPORAL (72 h, cambio obligatorio al entrar) y guarda las temporales solo en
// _work/secrets/nube-presentacion.json (fuera de Git). Nunca imprime contraseñas. Cada persona elige la suya en
// «Mi cuenta → Cambiar contraseña» o en el cambio inicial.
//
//   Raúl Administrador · Raúl Preparador · Raúl Revisor · Cloud Strife · Garen · Profesor (cliente exclusivo de la app)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { equipo, exigir } from "./_sesion.mjs";

const SALIDA = resolve(import.meta.dirname, "..", "..", "..", "_work", "secrets", "nube-presentacion.json");
const guardado = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, "utf8")) : { advertencia: "Contraseñas TEMPORALES de las cuentas de presentación. NO VERSIONAR NI COMPARTIR.", cuentas: {} };
const MOTIVO = "Cuenta de la presentación";
const PERSONAS = [
  { nombre: "Raúl Administrador", correo: "raul.administrador@softarq.test", funciones: ["ADMIN_SISTEMA", "ADMIN_CATALOGO"] },
  { nombre: "Raúl Preparador", correo: "raul.preparador@softarq.test", funciones: ["PREPARADOR"] },
  { nombre: "Raúl Revisor", correo: "raul.revisor@softarq.test", funciones: ["REVISOR"] },
  { nombre: "Cloud Strife", correo: "cloud.strife@softarq.test", funciones: ["PREPARADOR"] },
  { nombre: "Garen", correo: "garen.revisor@softarq.test", funciones: ["REVISOR"] },
];
const CLIENTE = { nombre: "Profesor", correo: "profesor.demo@clientes.softarq.test" };

const adm = await equipo("admin");
const existentes = exigir(await adm.get("/api/v1/admin/personas?incluirInactivas=true&limite=100"), [200], "Listar personas").personas;
for (const p of PERSONAS) {
  const ya = existentes.find((x) => x.correo === p.correo);
  if (ya) {
    // Si se creó pero su temporal no quedó guardada (y sigue pendiente de cambio), se restablece para poder entregarla.
    if (ya.cambioContrasenaPendiente && !guardado.cuentas[p.correo]) {
      const r = exigir(await adm.post(`/api/v1/admin/personas/${ya.id}/restablecimiento`, { motivo: MOTIVO }), [200, 201], `Restablecer ${p.nombre}`);
      guardado.cuentas[p.correo] = { nombre: p.nombre, funciones: p.funciones, contrasenaTemporal: r.contrasenaTemporal, temporalExpiraEn: r.temporalExpiraEn ?? null };
      writeFileSync(SALIDA, JSON.stringify(guardado, null, 2));
      console.log(`• ${p.nombre}: existe con temporal sin entregar; restablecida (guardada en el archivo local protegido)`);
    } else console.log(`• ${p.nombre}: ya existe (${ya.activa ? "activa" : "inactiva"}); se conserva`);
    continue;
  }
  const r = exigir(await adm.post("/api/v1/admin/personas", { correo: p.correo, nombre: p.nombre, funciones: p.funciones, motivo: MOTIVO }), [201], `Alta de ${p.nombre}`);
  guardado.cuentas[p.correo] = { nombre: p.nombre, funciones: p.funciones, contrasenaTemporal: r.contrasenaTemporal, temporalExpiraEn: r.temporalExpiraEn ?? r.persona?.temporalExpiraEn ?? null };
  writeFileSync(SALIDA, JSON.stringify(guardado, null, 2));
  console.log(`• ${p.nombre}: creada con contraseña temporal (guardada en el archivo local protegido)`);
}

// Cliente exclusivo de la app: Cliente propio, contacto DEMO completo para poder emitir (BL-01) y acceso de la app.
const prep = await equipo("preparador");
const lista = exigir(await prep.get("/api/v1/clientes?incluirInactivos=true&limite=100&buscar=Profesor"), [200], "Buscar cliente").clientes;
let cliente = lista.find((c) => c.nombre === CLIENTE.nombre);
if (!cliente) {
  cliente = exigir(await prep.post("/api/v1/clientes", { nombre: CLIENTE.nombre, contactoNombre: "Profesor", contactoTelefono: "55 5555 0100", contactoCorreo: CLIENTE.correo }), [201], "Alta del cliente");
  console.log("• Cliente «Profesor»: creado con contacto DEMO completo");
} else console.log("• Cliente «Profesor»: ya existe; se conserva");
if (cliente.clasificacion !== "PRESENTACION") {
  exigir(await adm.put(`/api/v1/clientes/${cliente.id}/clasificacion`, { categoria: "PRESENTACION", motivo: MOTIVO }), [200], "Clasificar al cliente");
  console.log("• Cliente «Profesor»: clasificado como Presentación");
}
const rAcc = await adm.get(`/api/v1/clientes/${cliente.id}/acceso`);
const accesos = rAcc.status === 404 ? [] : exigir(rAcc, [200], "Accesos del cliente").accesos;
if (!accesos.some((a) => a.correo === CLIENTE.correo)) {
  const r = exigir(await adm.post(`/api/v1/clientes/${cliente.id}/acceso`, { correo: CLIENTE.correo, nombre: CLIENTE.nombre, motivo: MOTIVO }), [200, 201], "Acceso del cliente");
  guardado.cuentas[CLIENTE.correo] = { nombre: CLIENTE.nombre, funciones: ["CLIENTE"], contrasenaTemporal: r.contrasenaTemporal, temporalExpiraEn: r.temporalExpiraEn };
  console.log("• Acceso de «Profesor» a la app: creado con contraseña temporal (guardada en el archivo local protegido)");
} else console.log("• Acceso de «Profesor»: ya existe; se conserva");
writeFileSync(SALIDA, JSON.stringify(guardado, null, 2));
console.log("\nListo. Las contraseñas temporales caducan a las 72 h; cada persona elige la suya al entrar.");
