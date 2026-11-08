# BW BOT PREMIUM en Termux (Android)

Termux es una opción cómoda para empezar y para uso personal. Es **el mismo código** que se usa en
VPS y Docker: lo único que cambia es la forma de mantenerlo vivo. Android puede cerrar apps en segundo
plano para ahorrar batería, así que para producción seria con disponibilidad continua se recomienda un
VPS (ver `README-HOSTING.md`). Esta guía te deja el bot lo más estable posible en el teléfono.

## Requisitos

- Termux instalado desde **F-Droid** (la versión de Google Play está desactualizada y falla con paquetes nuevos).
- Android con al menos 1 GB libre y conexión estable.
- Un número de WhatsApp para el bot (no necesita ser tu número personal).
- Node.js 20 o superior (el instalador lo instala).

## Instalación

1. Copia el proyecto al teléfono (por ejemplo, descomprime `BW-BOT-PREMIUM.zip` dentro de Termux).
   Si quieres leer archivos de la memoria del teléfono, ejecuta antes `termux-setup-storage`.
2. Entra a la carpeta y ejecuta el instalador:

   ```bash
   cd BW-BOT-PREMIUM
   bash install-termux.sh
   ```

   El instalador comprueba Node.js, npm y git (en Termux los instala con `pkg`), crea las carpetas
   `data/`, copia `.env.example` a `.env`, instala las dependencias y ejecuta `npm run check`.

3. Edita `.env` y define el número del bot con código de país, sin `+`:

   ```bash
   nano .env
   ```

   ```
   BOT_PHONE=593991234567
   OWNER_NUMBER=593990192338
   ```

## Emparejamiento (Pairing Code)

1. Inicia el bot: `npm start`
2. Verás en pantalla un código de 8 caracteres con formato `ABCD-1234`.
3. En el WhatsApp del bot: **Dispositivos vinculados → Vincular un dispositivo → Vincular con el número de teléfono**
   y escribe el código.
4. Cuando aparezca `Conectado a WhatsApp`, el emparejamiento terminó. No hace falta QR.

La sesión se guarda en `data/session/`. Después de reiniciar, el bot **no vuelve a pedir el código**.
Mientras exista esa carpeta, no borres ni muevas `data/`.

## Mantenerlo 24/7 en Android

Haz esto una vez:

1. **Evita que Android lo duerma**: en Termux ejecuta `termux-wake-lock` (o usa "Adquirir wakelock" en la notificación de Termux).
2. En Ajustes de Android → Aplicaciones → Termux → Batería: elige **Sin restricciones** (el nombre varía según el fabricante).
3. Mantén el teléfono conectado a la corriente y a una red estable.
4. Usa un gestor de procesos para que se reinicie solo si cae:

   ```bash
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   ```

   Comandos útiles: `pm2 logs bw-bot-premium`, `pm2 restart bw-bot-premium`, `pm2 stop bw-bot-premium`.

5. **Arranque automático al reiniciar el teléfono** (opcional): instala la app *Termux:Boot* desde F-Droid,
   ábrela una vez y crea el archivo `~/.termux/boot/bw-bot.sh`:

   ```bash
   mkdir -p ~/.termux/boot
   cat > ~/.termux/boot/bw-bot.sh <<'EOF'
   #!/data/data/com.termux/files/usr/bin/sh
   termux-wake-lock
   cd "$HOME/BW-BOT-PREMIUM" && pm2 resurrect
   EOF
   chmod +x ~/.termux/boot/bw-bot.sh
   ```

Sin PM2 también puedes ejecutar `npm start` dentro de `tmux` (`pkg install tmux`), pero no se reiniciará solo si cae.

## Qué pasa cuando el teléfono se apaga o se reinicia

- La **sesión de WhatsApp** y la **base de datos** (`data/`) persisten en disco.
- El bot se **reconecta solo** con espera progresiva (2 s, 4 s, 8 s… hasta 2 min) si se cae la red.
- Las tareas programadas (GDC, torneos, scrims, recordatorios) se **reconstruyen al arrancar** desde la base de datos:
  si un aviso venció mientras estaba apagado hace menos de `SCHEDULER_GRACE_SECONDS` (5 min por defecto) se envía una vez;
  si venció hace más, se descarta. Nunca se envía dos veces el mismo aviso.
- Si Android mata el proceso, el apagado no es limpio, pero la base de datos usa escritura atómica y copia `.bak`,
  así que no se corrompe.

## Backups

```bash
npm run backup
```

Crea una copia en `data/backups/` (se conservan las últimas `DB_BACKUP_KEEP`). Además se hace un backup automático cada
`DB_BACKUP_MINUTES` minutos. Para sacar una copia a la memoria del teléfono: `cp data/backups/db-*.json ~/storage/shared/`
(requiere haber ejecutado `termux-setup-storage`).

## Monitoreo

Activa el health check en `.env` con `HEALTH_PORT=3000` y reinicia. Luego:

```bash
curl http://127.0.0.1:3000/health   # el proceso responde
curl http://127.0.0.1:3000/ready    # WhatsApp conectado
curl http://127.0.0.1:3000/status   # JSON: uptime, estado de WhatsApp, memoria, scheduler
```

## Actualizar

```bash
pm2 stop bw-bot-premium
# reemplaza los archivos del proyecto, conserva .env y data/
npm ci
npm run check
pm2 restart bw-bot-premium
```

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `Falta BOT_PHONE` | No definiste el número del bot | Edita `.env` y reinicia |
| `Ya hay otra instancia de BW BOT en ejecución` | Hay otro proceso usando la misma sesión | `pm2 list` o `ps`; detén el otro. Si quedó un lock tras una caída, el bot lo reconoce como obsoleto solo |
| `La sesión fue cerrada desde el teléfono` | Quitaron el dispositivo desde WhatsApp | Detén el bot, borra `data/session/` y vuelve a emparejar |
| `Sesión corrupta (badSession)` / errores `Bad MAC` | Sesión dañada | El bot aparta la carpeta como `data/session.corrupt-...`; reinicia y empareja otra vez |
| Se desconecta cada pocos minutos | Android durmió Termux o red inestable | Revisa wakelock y batería sin restricciones |
| `No está instalada la dependencia @whiskeysockets/baileys` | Falló `npm install` | Ejecuta `npm ci` de nuevo con conexión a Internet |
| `npm ci` falla por git | Falta git | `pkg install git` |

## Multimedia, tools y multi-API (Fases 10-13)
- `.play` guarda archivos temporales en `data/tmp/media` (se limpian solos al arrancar) y una caché en `data/mediacache` (límite `PLAY_FILE_CACHE_MB`). No hace falta ffmpeg ni ningún programa externo.
- Los proveedores de Free Fire, clanes y medios se configuran en `.env` (ver `.env.example` y `docs/API_PROVIDERS.md`); **las claves nunca van en el ZIP ni en git**.
- `.apistatus` muestra el estado de los proveedores; `.apistatus probar` (ADMIN) los verifica si defines `FF_HEALTH_UID`, `CLAN_HEALTH_ID` o `MEDIA_HEALTH_QUERY`.
- Pendiente de verificar con el entorno real: envío de audio/video/imagen y botones nativos por WhatsApp.
