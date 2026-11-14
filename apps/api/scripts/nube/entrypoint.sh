#!/bin/sh
# Arranque del contenedor: prepara el volumen persistente y baja a un usuario sin privilegios (ADR-0025).
# El volumen se monta como root; la API no corre como root. exec deja a node como PID 1 (recibe SIGTERM).
set -e
if [ -n "$SOFTARQ_DIR_DOCUMENTOS" ]; then
  mkdir -p "$SOFTARQ_DIR_DOCUMENTOS"
  chown -R node:node "$(dirname "$SOFTARQ_DIR_DOCUMENTOS")"
fi
mkdir -p /tmp/respaldo && chown node:node /tmp/respaldo
exec setpriv --reuid=node --regid=node --init-groups node scripts/nube/arranque.mjs
