# Guía de presentación (DEMO en línea)

Datos ficticios (DEMO). Panel: https://softarq-production.up.railway.app · APK: ver el [README](../../README.md#demo-en-línea). Las contraseñas no se publican: las entrega el propietario por el archivo local protegido y cada persona elige la suya.

## Cuentas de la demostración

| Persona | Función | Dónde entra |
|---|---|---|
| Raúl Administrador | Administrador del sistema y del catálogo | Panel |
| Raúl Preparador, Cloud Strife | Preparador | Panel |
| Raúl Revisor, Garen | Revisor | Panel |
| Profesor | Cliente (propio Cliente, sin solicitudes ajenas) | App Android |
| Raul (cuenta existente) | Cliente, con su solicitud y COT-2026-00056 | App Android |

- **Elegir la contraseña:** al entrar con la temporal (72 h) el panel pide el cambio; después, «Mi cuenta → Cambiar contraseña» (pide la actual y cierra todas las sesiones). Se puede elegir la misma contraseña para las cuentas internas.
- **Separación:** quien prepara una versión no puede aprobarla aunque tenga la función de Revisor.
- Las cuentas internas anteriores (`[DEMO] …`) siguen siendo autoras de los documentos históricos y no se reasignaron.

## Qué muestra el panel al abrir

La vista inicial es la de **presentación**: listas, bandeja de solicitudes y contadores de «Mi trabajo» muestran los ejemplos de presentación. «Todo el historial» (selector de «Mi trabajo» o filtro «Clasificación» de cada lista) abre el resto sin cambiar nada en el servidor.

Ejemplos completos conservados (solicitud → atención → precios → revisión → emisión):

| Trabajo | Ejemplos |
|---|---|
| Cubierta | COT-2026-00055 (Laura Méndez), COT-2026-00064 (Héctor Ríos) |
| Losa | COT-2026-00056 (Raul), COT-2026-00063 (Laura Méndez) |
| Muro | COT-2026-00062 (Laura Méndez), COT-2026-00065 (Silvia Aranda) |

## Recorrido en directo (con el Profesor)

1. **App (Profesor):** crea su obra, elige el trabajo, escribe las medidas, ve la estimación preliminar y envía la solicitud. Cada solicitud enviada se conserva y se sigue individualmente.
2. **Panel (Raúl Preparador o Cloud Strife):** «Solicitudes» → «Actualizar» → abrir → «Atender»; elegir los precios de forma explícita, calcular y enviar a revisión.
3. **Panel (Raúl Revisor o Garen):** «Revisiones» → aprobar.
4. **Panel (Preparador):** emitir el PDF.
5. **App (Profesor):** la cotización emitida aparece y se descarga el PDF; en el panel, el historial de la cotización muestra versiones, revisión, aprobación, emisión y eventos.

## Preparación y comprobaciones

Scripts en `scripts/nube/` (ver la [guía de despliegue](despliegue-railway.md)): `preparar-cuentas.mjs`, `crear-ejemplos.mjs`, `limpiar-demo.mjs`, `recorrido-nube.mjs`, `verificar-historial.mjs`, `respaldar-nube.mjs`.

## Aceptación y cierre

**Aceptación del propietario (14/11/2026), declaración suya:** el proyecto queda aceptado y terminado para su entrega y exposición académica. Confirma que probó personalmente el recorrido completo de la app y el panel, que reemplazó las contraseñas temporales por contraseñas personales (no se guardan en ningún archivo ni repositorio) y que revisó y aprobó la presentación final. Es una aceptación humana; las pruebas automatizadas y las verificaciones en línea descritas en esta documentación son comprobaciones técnicas distintas y no la sustituyen.

**Respaldo final de la nube:** `softarq_dev-20261114T231737Z-e06c9b` (AES-256-GCM, 24 archivos, base y 21 PDF), descargado y verificado con `scripts/nube/respaldar-nube.mjs`; cifrado en `respaldos\softarq_nube\` de la laptop del propietario, con la clave guardada aparte.
