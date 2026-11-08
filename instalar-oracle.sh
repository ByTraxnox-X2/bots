#!/usr/bin/env bash
# ============================================================================
#  GUILD GLORY BOT · Instalador para VPS (Oracle Cloud gratis)
#  Sirve en Ubuntu/Debian y en Oracle Linux/Rocky/Alma, en máquinas ARM o AMD.
#
#  Qué hace:
#   1. Instala Node.js 20 y Python (si faltan). Si la máquina tiene poca RAM
#      (como la AMD chiquita de 1 GB), le agrega 2 GB de memoria extra (swap).
#   2. Crea un entorno de Python propio (.venv) con las librerías del bot.
#   3. Abre el puerto del panel en el firewall de Ubuntu.
#   4. Deja el bot como servicio: arranca solo al prender el VPS y se
#      reinicia solo si se cae.
#
#  Uso (dentro de la carpeta del bot):   bash instalar-oracle.sh
#  Se puede volver a correr sin problema (no borra tus bots).
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
USUARIO_SO="${SUDO_USER:-$(whoami)}"
SERVICIO="guildglory"

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarillo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
rojo() { printf '\033[1;31m%s\033[0m\n' "$*"; }

if [ ! -f "$DIR/main.py" ] || [ ! -f "$DIR/index.js" ]; then
  rojo "Corre este archivo dentro de la carpeta del bot (donde están main.py e index.js)."
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  rojo "Falta 'sudo' en este sistema."; exit 1
fi

# ---------- puerto del panel (de .env, o 8080) ----------
PUERTO="$(grep -E '^PUERTO_PANEL=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -dc '0-9' || true)"
PUERTO="${PUERTO:-8080}"
if ! grep -qE '^PUERTO_PANEL=' .env 2>/dev/null; then
  echo "PUERTO_PANEL=$PUERTO" >> .env
fi

# ---------- ¿Ubuntu/Debian (apt) u Oracle Linux/Rocky/Alma (dnf)? ----------
if command -v apt-get >/dev/null 2>&1; then
  SISTEMA="apt"
elif command -v dnf >/dev/null 2>&1; then
  SISTEMA="dnf"
elif command -v yum >/dev/null 2>&1; then
  SISTEMA="yum"
else
  rojo "No reconozco este sistema (no tiene apt ni dnf)."; exit 1
fi
echo "      Sistema: $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-desconocido}") · $(uname -m)"

verde "1/6 · Actualizando la lista de programas..."
if [ "$SISTEMA" = "apt" ]; then
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -y
else
  sudo "$SISTEMA" makecache -y >/dev/null 2>&1 || true
fi

verde "2/6 · Instalando Python, unzip y herramientas..."
if [ "$SISTEMA" = "apt" ]; then
  sudo apt-get install -y python3 python3-venv python3-pip curl unzip ca-certificates
else
  sudo "$SISTEMA" install -y python3 python3-pip curl unzip ca-certificates tar
fi

# El bot necesita Python 3.9 o más nuevo. Oracle Linux 8 trae 3.6: se instala uno nuevo.
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PY="$(command -v "$c")"; break
  fi
done
if [ -z "$PY" ]; then
  verde "      Este sistema trae un Python viejo; instalando Python 3.11..."
  if [ "$SISTEMA" = "apt" ]; then
    sudo apt-get install -y python3.11 python3.11-venv || true
  else
    sudo "$SISTEMA" install -y python3.11 python3.11-pip || sudo "$SISTEMA" install -y python3.11 || true
  fi
  command -v python3.11 >/dev/null 2>&1 && PY="$(command -v python3.11)"
fi
if [ -z "$PY" ]; then
  rojo "No pude conseguir Python 3.9 o más nuevo en este sistema."; exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(parseInt(process.versions.node)>=18?0:1)'; then
  verde "      Instalando Node.js 20..."
  if [ "$SISTEMA" = "apt" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo "$SISTEMA" install -y nodejs
  fi
fi
echo "      Node $(node -v) · $("$PY" --version)"

# ---------- memoria extra (swap) si la máquina tiene poca RAM ----------
RAM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "${RAM_MB:-0}" -lt 2500 ] && [ "${SWAP_MB:-0}" -lt 1000 ]; then
  verde "      La máquina tiene ${RAM_MB} MB de RAM: agrego 2 GB de memoria extra (swap)..."
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
  fi
  sudo swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

verde "3/6 · Preparando las librerías del bot (la primera vez tarda 1-3 minutos)..."
if [ ! -x "$DIR/.venv/bin/python" ]; then
  "$PY" -m venv "$DIR/.venv"
fi
"$DIR/.venv/bin/python" -m pip install --upgrade pip -q
"$DIR/.venv/bin/python" -m pip install -r "$DIR/requirements.txt" -q
"$DIR/.venv/bin/python" -c 'import aiohttp, httpx, Crypto, google_play_scraper, google.protobuf, protobuf_decoder' \
  && echo "      Librerías listas."

verde "4/6 · Abriendo el puerto $PUERTO en el firewall de la máquina..."
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  # Oracle Linux / Rocky / Alma usan firewalld
  sudo firewall-cmd --permanent --add-port="$PUERTO"/tcp >/dev/null
  sudo firewall-cmd --reload >/dev/null
elif command -v iptables >/dev/null 2>&1; then
  if ! sudo iptables -C INPUT -p tcp --dport "$PUERTO" -j ACCEPT 2>/dev/null; then
    # Las imágenes de Oracle traen una regla REJECT al final: la nuestra va antes.
    N="$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
    if [ -n "${N:-}" ]; then
      sudo iptables -I INPUT "$N" -p tcp --dport "$PUERTO" -j ACCEPT
    else
      sudo iptables -A INPUT -p tcp --dport "$PUERTO" -j ACCEPT
    fi
  fi
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save >/dev/null 2>&1 || true
  elif [ "$SISTEMA" = "apt" ]; then
    sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
    sudo netfilter-persistent save >/dev/null 2>&1 || true
  fi
fi
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo ufw allow "$PUERTO"/tcp >/dev/null || true
fi

verde "5/6 · Dejando el bot como servicio (arranca solo)..."
NODE_BIN="$(command -v node)"
sudo tee /etc/systemd/system/$SERVICIO.service >/dev/null <<EOF
[Unit]
Description=Guild Glory Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USUARIO_SO
WorkingDirectory=$DIR
ExecStart=$NODE_BIN $DIR/index.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
LimitNOFILE=65535
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
sudo chown -R "$USUARIO_SO":"$USUARIO_SO" "$DIR"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICIO" >/dev/null 2>&1
sudo systemctl restart "$SERVICIO"
verde "6/6 · Revisando que haya quedado encendido..."
sleep 4

IP="$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo
if systemctl is-active --quiet "$SERVICIO"; then
  verde "Listo. El bot está encendido."
else
  amarillo "El servicio no quedó encendido. Mira qué pasó con:  journalctl -u $SERVICIO -n 50"
fi
echo
echo "  Panel:        http://$IP:$PUERTO"
echo "  Usuario:      $(grep -E '^PANEL_USER=' .env | cut -d= -f2)"
echo "  Ver consola:  journalctl -u $SERVICIO -f"
echo "  Reiniciar:    sudo systemctl restart $SERVICIO"
echo "  Apagar:       sudo systemctl stop $SERVICIO"
echo
amarillo "IMPORTANTE: en la página de Oracle también hay que abrir el puerto $PUERTO"
amarillo "(Red virtual > Subred > Lista de seguridad > Agregar regla de entrada, TCP $PUERTO)."
amarillo "Si no lo abres allí, el panel no carga desde fuera aunque el bot esté encendido."
