# BW BOT PREMIUM con Docker

La misma base de código en un contenedor: reinicio automático, datos persistentes en un volumen, apagado limpio
y health check integrados. Necesitas Docker Engine 24+ con el plugin Compose (`docker compose`).

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `Dockerfile` | Imagen en dos etapas (Node 22), usuario sin privilegios, `HEALTHCHECK` y volumen `/app/data` |
| `docker-compose.yml` | Servicio con `restart: unless-stopped`, volumen `bw_data`, 30 s de gracia al apagar y límites de logs |
| `.dockerignore` | Excluye `.env`, `data/`, `node_modules` y tests de la imagen (los secretos no entran en ella) |

## Puesta en marcha

```bash
cp .env.example .env
nano .env                       # define BOT_PHONE=593991234567 y revisa OWNER_NUMBER
docker compose up -d --build
docker compose logs -f bw-bot   # aquí aparece el código de emparejamiento
```

En los logs verás un código `ABCD-1234`. En el WhatsApp del bot: **Dispositivos vinculados → Vincular con el número
de teléfono** y escríbelo. Cuando aparezca `Conectado a WhatsApp`, no necesitas hacer nada más: la sesión queda guardada en
el volumen `bw_data`.

Las rutas internas (`DATA_DIR`, `SESSION_DIR`, `BACKUP_DIR`, `LOG_DIR`) y el health check (`HEALTH_PORT=3000`) ya
vienen fijados por el Dockerfile y el compose; el resto de variables sale de tu `.env`.

## Operación diaria

| Acción | Comando |
| --- | --- |
| Estado | `docker compose ps` |
| Logs en vivo | `docker compose logs -f bw-bot` |
| Reiniciar | `docker compose restart bw-bot` |
| Detener (apagado limpio, hasta 30 s) | `docker compose stop bw-bot` |
| Detener y quitar el contenedor (conserva los datos) | `docker compose down` |

`docker compose down -v` **borra el volumen** con la sesión y la base de datos. No lo uses salvo que quieras empezar de cero.

## Health check

El contenedor se marca como `healthy` según `/health`. Desde el servidor:

```bash
curl http://127.0.0.1:3000/health   # el proceso responde
curl http://127.0.0.1:3000/ready    # 200 solo si WhatsApp está conectado
curl http://127.0.0.1:3000/status   # JSON con uptime, estado de WhatsApp, memoria y scheduler
docker inspect --format '{{.State.Health.Status}}' bw-bot-premium
```

El puerto solo se publica en `127.0.0.1`. No lo expongas a Internet.

## Reinicio automático y recuperación

- Si el proceso cae, Docker lo reinicia (`restart: unless-stopped`); también arranca solo al encender el servidor si el servicio Docker está habilitado.
- Al arrancar, el bot reutiliza la sesión del volumen (no pide emparejar de nuevo), recupera la base de datos y reconstruye las tareas programadas.
- Un aviso que venció durante la caída se envía una vez si fue hace menos de `SCHEDULER_GRACE_SECONDS`; si no, se descarta. Nunca se duplica.
- `docker compose stop` envía `SIGTERM`: el bot termina el envío en curso, guarda la base de datos y cierra la conexión antes de salir.

## Backups

```bash
# Crear un backup de la base de datos dentro del volumen
docker compose exec bw-bot node scripts/backup.js

# Copiar los backups fuera del contenedor
docker compose cp bw-bot:/app/data/backups ./backups-local

# Copia completa del volumen (sesión + base de datos + backups + logs)
docker volume ls | grep bw_data          # el nombre suele ser <carpeta>_bw_data
docker run --rm -v bw-bot-premium_bw_data:/data -v "$PWD":/backup busybox \
  tar czf /backup/bw_data.tgz -C /data .
```

Además el bot hace un backup automático cada `DB_BACKUP_MINUTES` minutos.

## Actualizar

```bash
# trae los cambios (git pull o archivos nuevos); conserva .env
docker compose up -d --build
docker compose logs -f bw-bot
```

El volumen no se toca al reconstruir la imagen, así que la sesión y los datos se conservan.

## Solución de problemas

| Síntoma | Qué hacer |
| --- | --- |
| Pide emparejar otra vez | Se perdió el volumen (`down -v` o cambio de nombre de proyecto). Revisa `docker volume ls` |
| `Falta BOT_PHONE` en los logs | Define `BOT_PHONE` en `.env` y ejecuta `docker compose up -d` |
| `La sesión fue cerrada desde el teléfono` | Quitaron el dispositivo desde WhatsApp. Borra la sesión: `docker compose exec bw-bot sh -c 'rm -rf /app/data/session'` y reinicia |
| Contenedor `unhealthy` | `docker compose logs --tail 100 bw-bot`; el proceso no responde o el puerto de salud cambió |
| `npm install` falla durante el build | El build necesita acceso a npm y a GitHub (algunas dependencias pueden instalarse desde allí) |
| Error de permisos en `/app/data` con un bind mount | El usuario del contenedor es `node` (uid 1000): `sudo chown -R 1000:1000 ./data` |

## Multimedia, tools y multi-API (Fases 10-13)
- `.play` guarda archivos temporales en `data/tmp/media` (se limpian solos al arrancar) y una caché en `data/mediacache` (límite `PLAY_FILE_CACHE_MB`). No hace falta ffmpeg ni ningún programa externo.
- Los proveedores de Free Fire, clanes y medios se configuran en `.env` (ver `.env.example` y `docs/API_PROVIDERS.md`); **las claves nunca van en el ZIP ni en git**.
- `.apistatus` muestra el estado de los proveedores; `.apistatus probar` (ADMIN) los verifica si defines `FF_HEALTH_UID`, `CLAN_HEALTH_ID` o `MEDIA_HEALTH_QUERY`.
- Pendiente de verificar con el entorno real: envío de audio/video/imagen y botones nativos por WhatsApp.
