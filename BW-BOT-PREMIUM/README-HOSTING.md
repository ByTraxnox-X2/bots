# BW BOT PREMIUM en VPS y hosting Node.js

Guía para servidores Linux (Ubuntu/Debian), hosting Node.js y servicios cloud. Es el mismo código que en
Termux y Docker; se configura solo con variables de entorno (`.env`).

## Reglas que valen en cualquier hosting

1. **Una sola instancia.** Una sesión de WhatsApp no se puede compartir entre procesos. El bot lo impide con un lock
   (`data/bot.lock`), pero no escales a varias réplicas.
2. **Disco persistente.** `data/` guarda la sesión de WhatsApp, la base de datos, los backups y los logs. Si tu hosting
   tiene sistema de archivos efímero (se borra al reiniciar), el bot pedirá emparejar de nuevo y perderás datos. Monta un
   volumen o disco persistente en esa ruta y apunta `DATA_DIR` hacia él.
3. **Node.js 20 o superior** y **git** instalado (algunas dependencias de Baileys pueden instalarse desde GitHub).
4. **Salida a Internet** hacia WhatsApp y hacia las APIs que configures.

## VPS Ubuntu/Debian

### 1. Preparar el servidor

```bash
sudo apt-get update
sudo apt-get install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # debe ser v20 o superior

# Usuario sin privilegios para el bot
sudo adduser --disabled-password --gecos "" bwbot
sudo mkdir -p /opt/bw-bot-premium && sudo chown bwbot:bwbot /opt/bw-bot-premium
```

### 2. Instalar el proyecto

```bash
sudo -iu bwbot
cd /opt/bw-bot-premium
# sube aquí los archivos del proyecto (git clone, scp o descomprimiendo el .zip)
cp .env.example .env
nano .env                 # define BOT_PHONE=593991234567 y revisa OWNER_NUMBER
npm ci                    # sin package-lock.json usa: npm install
npm run check
npm test
```

### 3. Primer arranque (emparejamiento)

El primer arranque hazlo en primer plano para ver el código:

```bash
npm start
```

Aparece un código `ABCD-1234`. En el WhatsApp del bot: **Dispositivos vinculados → Vincular con el número de teléfono**.
Cuando veas `Conectado a WhatsApp`, detén el bot con `Ctrl+C` (hace un apagado limpio) y pásalo a un gestor de procesos.

### 4a. PM2 (recomendado)

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup               # imprime un comando con sudo: ejecútalo para arrancar al encender el servidor
```

`ecosystem.config.js` ya trae una instancia en modo fork, reinicio automático con espera creciente,
reinicio si supera 512 MB y 20 s de margen para el apagado limpio.

| Acción | Comando |
| --- | --- |
| Ver estado | `pm2 status` |
| Ver logs | `pm2 logs bw-bot-premium` |
| Reiniciar | `pm2 restart bw-bot-premium` |
| Detener | `pm2 stop bw-bot-premium` |

### 4b. systemd (alternativa sin PM2)

Crea `/etc/systemd/system/bw-bot.service`:

```ini
[Unit]
Description=BW BOT PREMIUM
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bwbot
WorkingDirectory=/opt/bw-bot-premium
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bw-bot
sudo journalctl -u bw-bot -f      # logs
sudo systemctl restart bw-bot
```

### Actualizar

```bash
cd /opt/bw-bot-premium
# trae los cambios (git pull o sube los archivos nuevos). Conserva .env y data/
npm ci
npm run check
npm test
pm2 restart bw-bot-premium        # o: sudo systemctl restart bw-bot
```

## Hosting Node.js (paneles y plataformas cloud)

Configura en el panel:

- **Comando de inicio:** `npm start` (instala antes con `npm ci`, o `npm install` si no hay `package-lock.json`).
- **Versión de Node:** 20 o superior.
- **Variables de entorno:** las del `.env.example` (el panel las inyecta; no hace falta subir `.env`).
- **Almacenamiento persistente:** monta un disco/volumen y apunta `DATA_DIR`, `SESSION_DIR`, `BACKUP_DIR` y `LOG_DIR` a esa ruta.
- **Health check:** si la plataforma exige un puerto HTTP, define `HEALTH_PORT` con el puerto que te asigne (por ejemplo el valor de `PORT`)
  y `HEALTH_HOST=0.0.0.0`. El endpoint de comprobación es `/health`.
- **Un solo proceso/réplica.**
- El código de emparejamiento aparece en la **consola** del panel durante el primer arranque.

## Variables de entorno de producción

```
BOT_PHONE=593991234567
OWNER_NUMBER=593990192338
LOG_LEVEL=info
DB_BACKUP_MINUTES=360
DB_BACKUP_KEEP=10
HEALTH_PORT=3000
```

Todas las variables disponibles están documentadas en `.env.example`.

## Backups y restauración

- Automático: cada `DB_BACKUP_MINUTES` minutos en `BACKUP_DIR`; se conservan los últimos `DB_BACKUP_KEEP`.
- Manual: `npm run backup`.
- Copia externa: programa una copia de `data/` fuera del servidor (por ejemplo con `rsync` o `rclone` desde cron).
  Con el bot detenido es la copia más segura; en marcha, copia al menos `data/backups/` y `data/session/`.

## Logs

- Consola: PM2 (`pm2 logs`) o journald (`journalctl`).
- Archivos: `data/logs/bot-AAAA-MM-DD.log` (JSON por línea, una por día). Nivel con `LOG_LEVEL`.
- Rota o limpia los archivos antiguos con `logrotate` o un cron (`find data/logs -mtime +30 -delete`).

## Solución de problemas

| Síntoma | Qué hacer |
| --- | --- |
| Pide emparejar tras cada reinicio | El disco no es persistente: monta un volumen en `DATA_DIR` |
| `Ya hay otra instancia de BW BOT en ejecución` | Hay dos procesos; deja solo uno (`pm2 list`, `systemctl status bw-bot`) |
| `La sesión fue cerrada desde el teléfono` | Detén el bot, borra `data/session/` y vuelve a emparejar |
| El proceso reinicia en bucle | Mira `pm2 logs`: configuración inválida (el bot dice qué variable) o falta de red |
| `/ready` responde 503 | WhatsApp aún no está conectado o se perdió la conexión; el bot reintenta solo |

## Multimedia, tools y multi-API (Fases 10-13)
- `.play` guarda archivos temporales en `data/tmp/media` (se limpian solos al arrancar) y una caché en `data/mediacache` (límite `PLAY_FILE_CACHE_MB`). No hace falta ffmpeg ni ningún programa externo.
- Los proveedores de Free Fire, clanes y medios se configuran en `.env` (ver `.env.example` y `docs/API_PROVIDERS.md`); **las claves nunca van en el ZIP ni en git**.
- `.apistatus` muestra el estado de los proveedores; `.apistatus probar` (ADMIN) los verifica si defines `FF_HEALTH_UID`, `CLAN_HEALTH_ID` o `MEDIA_HEALTH_QUERY`.
- Pendiente de verificar con el entorno real: envío de audio/video/imagen y botones nativos por WhatsApp.
