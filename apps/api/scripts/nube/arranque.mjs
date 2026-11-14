// Punto de entrada del servicio en línea (ADR-0025): operación puntual opcional y arranque de la API.
//  SOFTARQ_OPERACION=carga-inicial  → carga única e idempotente desde un respaldo cifrado.
//  SOFTARQ_OPERACION=respaldo       → respaldo cifrado publicado en el registro privado (respaldo-nube.mjs).
//  SOFTARQ_OPERACION=comprobar-credenciales → comprueba la rotación de la credencial del superusuario.
// Si la operación falla, el despliegue falla. Las variables de la operación se eliminan al terminar.
if (process.env.SOFTARQ_OPERACION === "carga-inicial") {
  await import("./operacion-inicial.mjs");
} else if (process.env.SOFTARQ_OPERACION === "respaldo") {
  await import("./respaldo-nube.mjs");
} else if (process.env.SOFTARQ_OPERACION === "comprobar-credenciales") {
  await import("./comprobar-credenciales.mjs");
}
await import("../../dist/main.js");
