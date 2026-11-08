#!/usr/bin/env bash
# Instalador de BW BOT PREMIUM para Termux (Android).
# También funciona como verificación de requisitos en Debian/Ubuntu y otros Linux:
# allí no instala paquetes del sistema, solo comprueba y te dice qué falta.
set -euo pipefail

cd "$(dirname "$0")"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }

IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; then
  IS_TERMUX=1
fi

echo "BW BOT PREMIUM - instalación"
if [ "$IS_TERMUX" = 1 ]; then ok "Entorno: Termux"; else ok "Entorno: Linux/otro (no Termux)"; fi

# 1. Paquetes del sistema
if [ "$IS_TERMUX" = 1 ]; then
  echo "Instalando paquetes de Termux (nodejs-lts, git)..."
  pkg update -y >/dev/null 2>&1 || warn "No se pudo actualizar la lista de paquetes (continuando)."
  pkg install -y nodejs-lts git >/dev/null || fail "No se pudieron instalar nodejs-lts y git con pkg."
fi

command -v node >/dev/null 2>&1 || fail "Node.js no está instalado. En Debian/Ubuntu usa NodeSource o nvm (ver DEPLOYMENT.md)."
command -v npm  >/dev/null 2>&1 || fail "npm no está instalado."
command -v git  >/dev/null 2>&1 || fail "git no está instalado (algunas dependencias de Baileys pueden instalarse desde GitHub)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Se requiere Node.js 20 o superior; tienes $(node -v)."
fi
ok "Node.js $(node -v), npm $(npm -v), git $(git --version | cut -d' ' -f3)"

# 2. Directorios de datos (sesión, base de datos, backups, logs)
mkdir -p data/session data/backups data/logs data/tmp
chmod 700 data/session
ok "Directorios de datos listos (data/)"

# 3. Archivo de configuración
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Creado .env a partir de .env.example"
  warn "Edita .env y define BOT_PHONE (tu número con código de país, sin +) antes de iniciar."
else
  ok ".env ya existe (no se modifica)"
fi

# 4. Dependencias
echo "Instalando dependencias de Node (puede tardar unos minutos)..."
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi
ok "Dependencias instaladas"

# 5. Verificación
node scripts/check.js
ok "Verificación del proyecto superada"

echo
echo "Listo. Siguientes pasos:"
echo "  1) nano .env            # define BOT_PHONE"
echo "  2) npm start            # aparecerá el código de vinculación (Pairing Code)"
if [ "$IS_TERMUX" = 1 ]; then
  echo "  3) Para 24/7 en Termux: termux-wake-lock y desactiva la optimización de batería para Termux."
  echo "     Guía completa: README-TERMUX.md"
else
  echo "  3) Para 24/7: PM2 o Docker. Guía: DEPLOYMENT.md"
fi
