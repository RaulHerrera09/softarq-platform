// Punto de entrada del servicio en línea (ADR-0025): carga inicial opcional y arranque de la API.
// SOFTARQ_OPERACION=carga-inicial ejecuta la carga única (idempotente) antes de escuchar; si falla, el despliegue falla.
if (process.env.SOFTARQ_OPERACION === "carga-inicial") {
  await import("./operacion-inicial.mjs");
}
await import("../../dist/main.js");
