# Despliegue de BW BOT PREMIUM (producción 24/7)

Una única base de código Node.js (20 o superior) que funciona igual en Termux, VPS Linux, hosting Node.js y Docker.
No hay código específico de plataforma: la configuración sale de variables de entorno (`.env`) y el entorno se
detecta solo para los logs y el estado.

## Elige dónde ejecutarlo

| Destino | Guía | Mantenerlo vivo |
| --- | --- | --- |
| Termux / Android | `README-TERMUX.md` | PM2 + `termux-wake-lock` + Termux:Boot |
| VPS Ubuntu/Debian, servidores cloud | `README-HOSTING.md` | PM2 o systemd |
| Hosting Node.js (paneles) | `README-HOSTING.md` | El propio panel (`npm start`) |
| Docker | `README-DOCKER.md` | `restart: unless-stopped` |

## Receta de producción

```bash
cp .env.example .env     # define BOT_PHONE y revisa el resto
npm ci                   # sin package-lock.json usa: npm install
npm run check            # sintaxis + coherencia de los archivos de despliegue
npm test                 # suite de pruebas
npm start                # primer arranque: aparece el código de emparejamiento
```

Después del emparejamiento, pasa el bot a PM2, systemd o Docker según tu entorno. No hace falta intervención manual
adicional: la sesión y los datos persisten.

## Qué hace el bot para sobrevivir 24/7

| Capacidad | Cómo funciona |
| --- | --- |
| Reconexión automática | Si WhatsApp se cae, reintenta con espera creciente (`RECONNECT_BASE_MS` hasta `RECONNECT_MAX_MS`) y se reinicia al reconectar. No entra en bucles agresivos |
| Sesión persistente | Se guarda en `SESSION_DIR`. Tras reiniciar no vuelve a pedir el código. Una sesión corrupta se aparta como `session.corrupt-...` |
| Base de datos persistente | Escritura atómica (archivo temporal + `rename`), copia `.bak`, recuperación automática si el archivo se corrompe y migraciones de esquema |
| Backups | Automáticos cada `DB_BACKUP_MINUTES` y manuales con `npm run backup`; rotación con `DB_BACKUP_KEEP` |
| Instancia única | Lock en `data/bot.lock`. Una segunda instancia termina con código 2; un lock huérfano tras una caída se reconoce como obsoleto |
| Apagado limpio | `SIGINT` y `SIGTERM`: cierra el health check, espera el envío en curso, cierra WhatsApp, vuelca la base de datos y libera el lock. Si algo se cuelga, sale forzado a los 15 s |
| Anti-crash | Los errores no capturados se registran y no tumban el proceso |
| Tareas programadas | Persisten en la base de datos y se reconstruyen al arrancar (ver más abajo) |
| Logs | Consola y archivo diario en `LOG_DIR`, nivel con `LOG_LEVEL`; las claves y tokens se censuran |

## Tareas programadas tras un reinicio

GDC, torneos, scrims y demás eventos usan el mismo scheduler, que guarda cada tarea en la base de datos con un id único
(por ejemplo `GDC_<grupo>_2026-10-04_18:50`).

- **Pendiente con hora futura:** se reanuda automáticamente.
- **Venció durante la caída, dentro de `SCHEDULER_GRACE_SECONDS`:** se ejecuta una vez al reconectar WhatsApp.
- **Venció hace más tiempo:** se marca como perdida y no se envía (un recordatorio tardío no sirve).
- **El proceso murió mientras enviaba:** se marca como interrumpida y **no se reenvía**, para no duplicar mensajes.
- **El envío falla (por ejemplo, sin conexión):** se reintenta con espera creciente, hasta 3 veces.
- Un mismo id nunca se ejecuta dos veces.
- Las tareas recurrentes (el recordatorio diario de GDC) programan solas la siguiente ocurrencia usando la zona `TZ_BOT`
  (por defecto `America/Guayaquil`).

## Monitoreo

Activa el servidor de salud con `HEALTH_PORT` (en Docker ya viene activo). Escucha en `HEALTH_HOST` (`127.0.0.1` por defecto).

| Endpoint | Respuesta |
| --- | --- |
| `/health` | `200` mientras el proceso responde (liveness) |
| `/ready` | `200` solo si WhatsApp está conectado; `503` en caso contrario |
| `/status` | JSON: versión, entorno, uptime, estado de WhatsApp, memoria, base de datos y scheduler. Nunca incluye claves |

## Señales y códigos de salida

| Situación | Resultado |
| --- | --- |
| `SIGTERM` / `SIGINT` | Apagado limpio, salida `0` |
| Configuración inválida | Salida `1` con el motivo en el log |
| Otra instancia ya en marcha | Salida `2` |
| Error fatal de WhatsApp (por ejemplo, reintentos agotados con `RECONNECT_MAX_ATTEMPTS`) | Apagado limpio, salida `1` |

Los gestores de procesos recomendados reinician el bot en los casos de salida distinta de `0`.

## Verificación después de desplegar

1. `npm run check` y `npm test` terminan sin errores.
2. `curl http://127.0.0.1:3000/ready` responde `200` (con `HEALTH_PORT=3000`).
3. Reinicia el servicio (`pm2 restart bw-bot-premium`, `systemctl restart bw-bot` o `docker compose restart bw-bot`):
   el bot debe volver a conectarse **sin** pedir un código nuevo.
4. Envía `.ping` al bot desde el número del OWNER (cuando los comandos estén activos en tu versión) y comprueba la respuesta.
5. `npm run backup` crea un archivo en `BACKUP_DIR`.

## Seguridad

- No subas ni compartas `.env`, `data/session/`, `data/backups/` ni `data/logs/`. Están en `.gitignore` y `.dockerignore`.
- Quien tenga `data/session/` controla la cuenta de WhatsApp del bot: protege esa carpeta (`chmod 700`).
- No expongas el puerto de salud a Internet; si necesitas verlo desde fuera, usa un proxy con autenticación o una VPN.
- Ejecuta el bot con un usuario sin privilegios (el Dockerfile y la guía de VPS ya lo hacen).
