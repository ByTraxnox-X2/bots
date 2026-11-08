# BW BOT PREMIUM

Bot de WhatsApp en español para comunidades de **Free Fire**: perfiles y niveles, consulta de jugadores y clanes con varias APIs
y *fallback* automático, GDC (guerra de clanes), equipos y partidas, juegos, torneos y scrims, ELO y rankings, economía
**virtual** (sin valor real), moderación de grupos, administración, sistema social, música/video (`.play`) y herramientas.
Node.js ≥ 20 (CommonJS) sobre [Baileys](https://github.com/WhiskeySockets/Baileys). Funciona 24/7 en Termux, VPS/Linux, Docker, PM2, Windows y macOS.

> **Importante – qué está probado y qué no.** Todo se probó con un WhatsApp **simulado** (`tests/harness.js`) y servidores HTTP locales.
> **No** se ha probado con WhatsApp real ni con APIs reales de Free Fire/clanes/medios (el entorno de desarrollo no tiene acceso).
> La lista exacta está en [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) y en [docs/API_PROVIDERS.md](docs/API_PROVIDERS.md).

## Inicio rápido
```bash
npm install                 # instala Baileys (único dependency)
cp .env.example .env        # edita OWNER_NUMBER, BOT_PHONE y tus APIs
npm run check && npm test   # opcional: verificación
npm start                   # primer arranque: pide el Pairing Code en consola
```
Guías por plataforma: [README-TERMUX.md](README-TERMUX.md) · [README-DOCKER.md](README-DOCKER.md) · [README-HOSTING.md](README-HOSTING.md) · [DEPLOYMENT.md](DEPLOYMENT.md).

## Qué incluye
| Área | Comandos (ejemplos) | Notas |
|---|---|---|
| Usuarios | `.registro .perfil .balance .nivel .vincular` | XP, niveles, monedas virtuales |
| Free Fire | `.ff .fffull` | multi-API con fallback, caché, salud |
| Clanes / GDC | `.verificarclan .clan .gdc …` | avisos persistentes en el scheduler |
| Equipos / partidas | `.equipo .partida` | capitán, invitaciones, resultados |
| Torneos / scrims | `.torneo .scrim` | cuadros, check-in, premios virtuales |
| Competitivo | `.ranking .elo .temporada .rival` | ELO idempotente tras reinicios |
| Juegos | `.ppt .trivia .duelo .batalla …` | apuestas virtuales con escrow |
| Social | `.amigos .logros .titulos` | datos reales del bot |
| Moderación / Admin / Owner | `.warn .mute .antilinks .backup .broadcast …` | permisos por rol |
| Play | `.play .playaudio .playvideo .buscar .infoaudio .miniatura` | proveedores configurables, validaciones |
| Tools | `.calc .convertir .qr .hash .uuid .fecha .hora .json …` | calculadora sin `eval`, QR propio |
| Menú | `.menu .help` | dinámico por rol/clan/GDC; botones o respuestas numeradas `.1 .2 …` |

La lista completa y generada desde el registro está en [COMMANDS.md](COMMANDS.md) (cada comando tiene handler, permisos, límite de uso y tests).

## Configuración
Todo se configura en `.env` (plantilla: [.env.example](.env.example)). **Las claves de API solo viven ahí**: nunca en el código, los logs
ni el ZIP. Lo más importante:
- `FREEFIRE_PROVIDERS` / `FF_PROVIDER_n_*` y `CLAN_PROVIDERS` / `CLAN_PROVIDER_n_*`: proveedores con prioridad, región, clave, tiempo límite y límite propio. Compatibles con las plantillas antiguas `FF_API_URLS` / `CLAN_API_URLS`.
- `MEDIA_PROVIDERS` / `MEDIA_PROVIDER_n_*` (o `PLAY_*`): proveedores de búsqueda y descarga de medios.
- `UI_BUTTONS=text|native`: por defecto listas numeradas (`.1`, `.2`…), que funcionan en cualquier cliente; `native` además intenta botones de WhatsApp.
- Base de datos JSON atómica con *backups* rotativos (`.backup`, `.restore`), logs, bloqueo de instancia única y health checks (`HEALTH_PORT`).

## Arquitectura (resumen)
```
src/
  app.js, whatsapp/        conexión Baileys, reconexión con backoff, JID/LID
  handlers/                parseo de mensajes y despachador (moderación → ban → mantenimiento → alcance → rol → registro → rate limit → handler)
  commands/, plugins/      registro validado de comandos + un plugin por área
  services/                lógica de negocio (usuarios, clanes, GDC, equipos, torneos, ELO, juegos, social, interacciones…)
  providers/               ProviderManager/Router/Health/Cache + adaptadores de Free Fire y clanes
  media/                   MediaService, proveedores, descargas seguras, caché de archivos, cola
  tools/                   calculadora, conversiones, QR, contenido
  scheduler/, database/    trabajos persistentes sin duplicados, JSON atómico con backups
tests/                     ~450 tests (WhatsApp simulado, servidores HTTP locales y procesos reales)
scripts/                   check, lint, verify-commands, verify-deploy, audit, backup, probes de APIs
```

## Verificación
```bash
npm test               # todos los tests
npm run check          # sintaxis de todos los .js
npm run lint
npm run verify-commands   # cada comando: handler, validación, permisos, límite de uso y test
npm run verify-deploy     # coherencia de Docker/PM2/Termux/.env.example
npm run audit             # sin relleno, duplicados, botones rotos ni secretos
```

## Pendiente de verificar con el entorno real
Pairing Code y conexión real, menciones, JID/LID, `groupMetadata`, expulsar/borrar mensajes, bienvenida/despedida, `tagall`/`hidetag`,
`broadcast`, botones nativos, envío de audio/video/imagen, ejecución de GDC/torneos/scrims a su hora, APIs reales de Free Fire y clanes,
proveedores de medios, Docker real, PM2 real y Termux real. Marcado en el código y la documentación como
**"Implementado, pendiente de verificación con entorno real"**.

## Seguridad
Nunca se ejecuta texto del usuario en una shell; la calculadora usa un analizador propio; las descargas solo aceptan URLs públicas y validan
tipo/firma/tamaño; las monedas son 100 % virtuales; los permisos se revalidan en cada comando y en cada botón.
