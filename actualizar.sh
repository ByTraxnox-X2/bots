#!/usr/bin/env bash
# ============================================================================
#  GUILD GLORY BOT · Actualizar en el VPS con un ZIP nuevo
#
#  Uso:   bash actualizar.sh /ruta/al/guildglory-bot-nuevo.zip
#
#  No toca tus bots: accounts.json, token_cache.json, devices.json,
#  clanes.json y clan_rotacion.json no vienen en el ZIP, así que se quedan.
# ============================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="${1:-}"
SERVICIO="guildglory"

if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then
  echo "Uso: bash actualizar.sh /ruta/al/archivo.zip"; exit 1
fi

echo "Copia de seguridad de tus datos..."
mkdir -p "$DIR/respaldos"
STAMP="$(date +%Y%m%d-%H%M%S)"
DATOS=()
for f in accounts.json token_cache.json devices.json clanes.json clan_rotacion.json .env; do
  [ -f "$DIR/$f" ] && DATOS+=("$f")
done
if [ "${#DATOS[@]}" -gt 0 ]; then
  tar -czf "$DIR/respaldos/datos-$STAMP.tar.gz" -C "$DIR" "${DATOS[@]}" || true
fi

echo "Apagando el bot..."
sudo systemctl stop "$SERVICIO" 2>/dev/null || true

echo "Copiando la versión nueva..."
# Tu .env (contraseña, puerto) se conserva: el del ZIP no lo pisa.
ENV_TMP=""
if [ -f "$DIR/.env" ]; then ENV_TMP="$(mktemp)"; cp "$DIR/.env" "$ENV_TMP"; fi
unzip -o -q "$ZIP" -d "$DIR"
if [ -n "$ENV_TMP" ]; then cp "$ENV_TMP" "$DIR/.env"; rm -f "$ENV_TMP"; fi

if [ -x "$DIR/.venv/bin/python" ]; then
  echo "Revisando librerías..."
  "$DIR/.venv/bin/python" -m pip install -r "$DIR/requirements.txt" -q
fi

echo "Encendiendo el bot..."
sudo systemctl start "$SERVICIO"
sleep 2
systemctl is-active --quiet "$SERVICIO" && echo "Listo, actualizado y encendido." \
  || echo "No encendió. Mira: journalctl -u $SERVICIO -n 50"
