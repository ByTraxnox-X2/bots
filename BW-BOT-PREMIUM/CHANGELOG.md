# Changelog

Formato: cambios por fase de desarrollo. Versión del paquete: 0.1.0.

## Fase 13 — Cierre
- `docs/API_PROVIDERS.md`, `README.md`, `CHANGELOG.md`; `npm run audit`; ZIP `BW-BOT-PREMIUM.zip` sin secretos, sesión ni `node_modules`.

## Fase 12 — Integración y auditoría
- `scripts/audit.js` (relleno, duplicados, botones rotos, secretos, archivos prohibidos) y `tests/integration.test.js`.
- Test de proceso real con SIGINT; `syncAll` idempotente; limpieza de temporales de medios al arrancar; botones caducan tras reinicio.
- Test flaky de `.quizff` corregido.

## Fase 11 — Menús y botones
- `InteractionService`: acciones = comandos reales ejecutados por el despachador (permisos y límites revalidados), respuestas numeradas `.N`, caducidad, botones nativos opcionales (`UI_BUTTONS=native`) con texto alternativo siempre incluido.
- `.menu` dinámico por rol, grupo, clan verificado y GDC; secciones PERFIL, FREE FIRE, GDC, EQUIPOS, TORNEOS, ECONOMÍA, JUEGOS, RANKING, SOCIAL, PLAY, TOOLS, MODERACIÓN, ADMIN, AYUDA.
- `parseIncoming` reconoce respuestas de botones, listas, plantillas e interactivos. `menu` y `help` sin cooldown propio.

## Fase 10 — Multimedia, tools y multi-API
- Multi-API Free Fire/clanes: `ProviderRegistry` (presets `hlgaming`, `ffcommunity`, `jinix`, `gameskinbo` + `generic`), `ProviderRouter`, `ProviderHealth`, `ProviderCache`, `ProviderManager`; prioridad, región soportada, reintentos con backoff, cooldown y recuperación, límite propio por proveedor, fusión segura por campos con procedencia, códigos de error (`PLAYER_NOT_FOUND`, `API_TIMEOUT`, …), health check.
- `.apistatus`: resumen para usuarios, detalle para ADMIN/OWNER, `apistatus probar`.
- `.play .playaudio .playvideo .buscar .buscarvideo .buscarmusica .infoaudio .infovideo .miniatura .abrir .playcancelar` con `MediaService`, `DownloadManager` (anti-SSRF, MIME/extensión/firma/tamaño), `MediaCache`, `MediaQueue`.
- Tools: `.ping .calc .convertir .fecha .hora .timestamp .qr .base64 .encode64 .decode64 .json .uuid .hash .md5 .sha256 .color .hex .random .dado .8ball .suerte .frase .chiste .texto .mayus .minus .contar .reverse .info .device`.
- Cambios: `.apistatus` ahora es USER (detalle según rol); el comando de prueba `ping` del test del despachador pasó a `pong`.

## Fases 1–9
Ver [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md): arquitectura 24/7, usuarios/XP/monedas, Free Fire y clanes, GDC, equipos y partidas, juegos, torneos y scrims, ELO/rankings/temporadas, administración, moderación y sistema social.
