# ADR-0024 — Respaldo cifrado con Vigenère (requisito académico)

- **Fecha:** 14/11/2026
- **Estado:** aceptada (implementada y probada en local)
- **Ámbito:** `apps/api/scripts/respaldo/` (`vigenere.mjs`, `cifrar.mjs`, `probar-cifrado.mjs`, `__tests__/vigenere.test.mjs`), scripts `respaldo:cifrar`, `respaldo:verificar-cifrado`, `respaldo:descifrar`, `respaldo:clave-*` y `respaldo:probar-cifrado`; [`docs/operacion/respaldo-y-restauracion.md`](../operacion/respaldo-y-restauracion.md) §9.

## Contexto

El profesor pidió aplicar el cifrado Vigenère al sistema de respaldo (ADR-0012). Vigenère es un cifrado clásico: no resiste un análisis moderno, no autentica y no oculta la longitud ni la estructura repetida. Se implementa como **requisito académico**, sin presentarlo como protección moderna.

## Decisión

1. **Alfabeto de bytes (256).** El volcado de PostgreSQL y los PDF son binarios, así que el alfabeto son los 256 valores de un byte y la aritmética es módulo 256: `c = (p + k[i mod n]) mod 256`; `p = (c − k[i mod n]) mod 256`. No se usa Base64 ni otra codificación previa (la codificación no sustituye al cifrado).
2. **Clave.** Frase de texto → NFC → UTF-8; cada byte es un desplazamiento. Mínimo 16 bytes. Se repite desde el byte 0 de **cada** archivo. La clave local se genera aleatoria (256 bits, base64url) con `respaldo:clave-crear` y se guarda con **DPAPI** de Windows en `_work\secrets\respaldo-vigenere.dpapi` (fuera de Git, del respaldo y de los registros; no se sobrescribe). Alternativa para pruebas: variable `SOFTARQ_RESPALDO_CLAVE_VIGENERE`.
3. **Qué se cifra.** Por separado: `base.dump`, cada PDF y el `manifiesto.json` original (metadatos de recuperación). Sin cabecera: el cifrado conserva el tamaño. El conjunto queda en `respaldos\softarq_dev_vigenere\<ID>\` con `manifiesto-cifrado.json` en claro (formato `softarq-respaldo-vigenere/1`: algoritmo, tamaños y SHA-256 del claro y del cifrado de cada archivo; nunca la clave).
4. **Compatibilidad.** El respaldo original no se modifica ni se mueve; no se tocan manifiestos históricos ni el formato `softarq-respaldo/1`. El cifrado parte de un respaldo COMPLETO y verificado. Descifrar produce un respaldo normal (`_work\respaldo-descifrado\<ID>`) que usa `respaldo:verificar` y `respaldo:restaurar` sin cambios. No se restaura sobre `softarq_dev`.
5. **Detección de fallos.** Si el SHA-256 del texto cifrado no coincide → archivo alterado, truncado o dañado; si coincide pero el claro no → clave incorrecta; sin clave → error explícito. Un fallo borra la carpeta parcial. Los SHA-256 detectan cambios accidentales o evidentes pero **no son autenticación criptográfica**: quien conozca la clave puede rehacer cifrado y manifiesto.
6. **Memoria.** Procesamiento por bloques (`Transform`, lectura de 256 KiB) con SHA-256 incremental; nunca se carga un archivo completo. Salida a un temporal exclusivo que se renombra al terminar.

## Límites

- Vigenère con clave repetida es vulnerable a análisis de frecuencias y a texto claro conocido (los PDF empiezan con `%PDF`, el volcado con `PGDMP`): con esos fragmentos se puede recuperar la clave. La clave aleatoria de 43 bytes lo dificulta frente a lectura casual, no frente a un atacante con conocimientos.
- Conservar la clave **por separado** es indispensable: sin ella el respaldo cifrado no se recupera (`respaldo:clave-mostrar --confirmar` en la terminal propia, guardada en un gestor de contraseñas o impresa y custodiada). DPAPI solo descifra con la misma cuenta de Windows de este equipo.

## Pendiente para Railway (NO implementado)

Cifrado **autenticado moderno** (p. ej. AES-256-GCM o XChaCha20-Poly1305 con clave en el gestor de secretos del servicio) como protección real del respaldo, complementando el requisito académico. Aún no existe.

## Pruebas

`vigenere.test.mjs` (unitarias) y `pnpm respaldo:probar-cifrado` (24 comprobaciones: respaldo real, cifrado, verificación, descifrado con SHA-256 idénticos, restauración en `softarq_restauracion`, clave incorrecta, truncado, alterado, ausencia de clave, memoria). Resultados reales en HANDOFF §30.
