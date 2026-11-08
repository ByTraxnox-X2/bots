# DEVELOPMENT_STATUS — BW BOT PREMIUM

Última actualización: 2026-10-04 (Fase 13 — cierre)

## Fase actual
**Fases 1–13 completadas.** El proyecto está listo para empaquetar (`BW-BOT-PREMIUM.zip`). No hay más fases.

**Verificación final:** `npm test` 449/449 · `npm run check` OK (135 archivos) · `npm run lint` OK · `npm run verify-commands` OK (139 comandos) ·
`npm run verify-deploy` OK · `npm run audit` OK.

## Qué se probó y qué NO (lectura obligatoria)
| Probado automáticamente (simulación) | NO probado con el entorno real — "Implementado, pendiente de verificación con entorno real" |
|---|---|
| Toda la lógica con WhatsApp simulado (`tests/harness.js`) | Pairing Code, conexión y reconexión reales de Baileys |
| Fallback multi-API con servidores HTTP locales (timeout, 429, 5xx, JSON inválido, auth, región…) | **Ninguna API real** de Free Fire, clanes ni medios (sin red desde el entorno de desarrollo; ver `docs/API_PROVIDERS.md`) |
| Descargas de medios con proveedor local (validaciones, SSRF, caché, cola) | Envío real de audio/video/imagen por WhatsApp (`wa.sendMedia`) |
| Botones: ids, caducidad, revalidación de permisos, `.N` | Botones/listas nativos de WhatsApp (`wa.sendButtons`; por defecto `UI_BUTTONS=text`) |
| Procesos reales: arranque, health, SIGTERM, **SIGINT**, segunda instancia, kill -9, tareas vencidas tras reinicio | Menciones, JID/LID, `groupMetadata`, expulsar, borrar mensajes, bienvenida/despedida, `tagall`, `hidetag`, `broadcast` en WhatsApp real |
| Scheduler persistente, idempotencia de ELO/premios/avisos tras reinicios, backups y restauración | Ejecución real a su hora de GDC, torneos y scrims en 24/7 |
| Generador de QR (decodificado con OpenCV durante el desarrollo) | Docker real, PM2 real, Termux real, `npm install` real (el registro devolvió 403 para Baileys; no se pudo generar `package-lock.json`) |

## Fase 10 — Multimedia, tools y multi-API (completada)
- **Multi-API (Free Fire/clanes):** `src/providers/{registry,router,health,cache,lookup-service}.js` (+ `freefire/`, `clans/`). Presets `hlgaming`, `ffcommunity`,
  `jinix`, `gameskinbo` y `generic` (plantilla); `FREEFIRE_PROVIDERS`, `CLAN_PROVIDERS`, `FF_PROVIDER_n_*`, `CLAN_PROVIDER_n_*`, compatibilidad con `FF_API_URLS`/`CLAN_API_URLS`.
  Prioridad, activar/desactivar, región soportada, reintentos acotados con backoff, cooldown y recuperación, límite propio, 429 con `Retry-After`, auth errors,
  fusión por campos con procedencia, caché que no oculta fallos, health check, códigos `PLAYER_NOT_FOUND … REGION_NOT_SUPPORTED`. `tests/multiapi.test.js` (23 tests).
- **`.apistatus`:** USER ve resumen; ADMIN/OWNER ven cada proveedor; `apistatus probar` (ADMIN).
- **Medios:** `src/media/*` (MediaService, ProviderManager, ProviderHealth, MediaCache, DownloadManager, MediaQueue) y `src/plugins/media` (11 comandos). `tests/media.test.js` (16 tests).
- **Tools:** `src/tools/*` (calc sin eval, convert, QR propio con PNG, contenido original) y `src/plugins/tools` (31 comandos incl. `.apistatus`). `tests/tools.test.js` (8 tests).
- `.uptime` y `.botstatus` siguen siendo OWNER (de la Fase 9) y `.coinflip` es el juego de la Fase 6.

## Fase 11 — Menús y botones (completada)
- `src/services/interactions.js` + `src/plugins/nav.js`; `.menu` y `.help` devuelven `actions`. Las acciones son comandos reales ejecutados por el despachador
  (permisos, registro y límites revalidados al pulsar). Respuestas `.N`, caducidad (`UI_BUTTON_TTL`), ligadas al usuario y al chat, en memoria (caducan al reiniciar).
- `parseIncoming` reconoce botones, listas, plantillas e interactivos. `tests/menu_buttons.test.js` (11 tests) comprueba que no hay botones muertos.

## Fase 12 — Integración y auditoría (completada)
- `scripts/audit.js` (`npm run audit`) y `tests/integration.test.js` (5 tests); test de proceso real con SIGINT; `syncAll` idempotente; limpieza de temporales al arrancar.
- Revisado: conexión, scheduler, usuarios, FF, APIs, clanes, GDC, equipos, juegos, torneos, scrims, ELO, economía, moderación, OWNER, social, medios, tools, menús, botones,
  backups, logs, health, Docker, PM2, Termux. Sin comandos sin handler, sin duplicados, sin acciones rotas, sin marcadores de relleno.
- Errores corregidos: test flaky de `.quizff` (aleatoriedad), colisión del comando de prueba `ping` con el real, `use strict` perdido en `lookup-service.js` (lint).

## Fase 13 — Cierre (completada)
- `README.md`, `CHANGELOG.md`, `docs/API_PROVIDERS.md`, `.env.example` completo, COMMANDS.md regenerado, ZIP `BW-BOT-PREMIUM.zip`.
- Limitaciones conocidas: sin `package-lock.json` (npm devolvió 403 para Baileys; `npm install` lo creará); ningún proveedor real verificado; botones nativos no verificados;
  `.device` es una heurística; el contexto de `.play` y los botones viven en memoria.

## Fase 5 — Equipos y partidas (completada)
**Verificación:** `npm test` 321/321 · `npm run check` OK · lint OK · verify-commands OK (28 comandos) · verify-deploy OK.
- `src/services/teams.js` (TeamService), `src/services/matches.js` (MatchService), `src/plugins/equipos/` (comandos `.equipo` con 18
  subcomandos y `.partida` con 12), `src/services/common.js` (ids correlativos persistentes + auditoría en `logs`),
  `src/services/extras.js` (cableado único de servicios de las fases 5-9, usado por app.js y por los tests), `tests/support.js`.
- Modalidades 2v2/4v4/6v6; un jugador solo en un equipo por modalidad; tamaño nunca superado; capitán/subcapitán; invitaciones
  con vigencia; salir/expulsar/traspasar/renombrar/disolver; estadísticas, historial, ranking y enfrentamientos directos.
- Partidas con estados reales pendiente → abierta → llena → iniciada → finalizada (y cancelada); rosters congelados; jugadores
  no duplicados ni en dos partidas a la vez; la plantilla no cambia en partidas llenas/iniciadas; resultado reportado por
  ambos capitanes (deben coincidir) o fijado por un administrador (con alcance al grupo donde se creó, o SUPERADMIN/OWNER).
  Finalizar es idempotente y emite `matchFinished` (la base del ELO de la Fase 8). Vencimiento persistente en el scheduler
  (`MATCH_EXP_<id>`), repuesto tras reinicios con `syncAll`.
- Probado: lifecycle completo, disputas, permisos, límites de plantilla, vencimiento, reinicio, idempotencia, auditoría, cooldown.
- Implementado, pendiente de verificación con WhatsApp real: menciones reales en invitaciones y rol de admin del grupo.

## Fase 6 — Juegos interactivos (completada)
**Verificación:** `npm test` 340/340 · check OK (90 archivos) · lint OK · verify-commands OK (43 comandos) · verify-deploy OK.
- `src/services/games.js` (motor): sesiones persistentes en la colección `games`; temporizadores = trabajos del scheduler
  (`GAME_<id>_<n>`, un temporizador viejo nunca actúa); apuestas con escrow y devolución al cancelar; premios con tope diario
  (`GAME_DAILY_COIN_CAP`) y XP; mensajes del temporizador en `outbox` (se reintentan si falla el envío); `syncAll()` tras
  reiniciar (repone temporizadores, cancela con devolución lo irrecuperable).
- 15 comandos reales: `ppt`, `dados`, `coinflip` (vs bot, apuesta opcional), `trivia`, `quizff`, `adivina`, `anagrama`,
  `memoria` (inversa), `reaccion` + `ya`, `duelo` (1v1 por turnos con apuesta), `batalla`, `supervivencia`, `eliminacion`
  (salas con rondas), `juegos` (lista, estado, stats, cancelar ADMIN). Código en `src/games/*` y `src/plugins/juegos`.
- El banco de trivia usa hechos comprobables; el de Free Fire es corto y conservador (7 preguntas) y un SUPERADMIN lo amplía
  con `.quizff agregar`: no se inventan datos del juego.
- Probado: todos los juegos (RNG controlado), apuestas, premios y tope diario, turnos, vencimientos, reinicio/recuperación,
  idempotencia (temporizador viejo, doble pago), reintento de envío, permisos, registro, ámbito de grupo, cooldown.
- Pendiente de verificar con WhatsApp real: puntualidad de los temporizadores y la precisión de `.ya` (mide desde que el bot
  procesa el mensaje, no desde que el usuario lo envió).

## Fase 7 — Torneos y scrims (completada)

- `.torneo` (25 subcomandos: crear, editar, abrir, cerrar, cancelar, eliminar, inscribir, salir, participantes, checkin, checkout, iniciar, bracket, ronda, partidas, proximos, historial, ganadores, premios, puntos, ranking, stats, descalificar, finalizar, info, lista) y `.scrim` (14: crear, info, unirse, salir, equipos, lista, horario, checkin, resultado, resolver, ranking, estadisticas, cancelar, historial).
- Estados de torneo: borrador → inscripcion → cerrado (check-in) → en_curso → finalizado/cancelado. Scrim: abierto → lleno → en_curso → finalizado/cancelado.
- Cuadro de eliminación directa con descansos (byes), sorteo/siembra, descalificación, premios (monedas virtuales) y puntos. Las partidas son partidas reales (`matches`, contexto torneo/scrim); los resultados los reportan capitanes (ambos coinciden) o un admin. Nunca se inventan.
- Scheduler persistente: cierre de inscripción, inicio, recordatorios y vencimiento; `syncAll` repone trabajos tras reiniciar sin duplicar.
- Idempotencia: `matchFinished` se emite una vez; el premio/puntos se aplican una sola vez por torneo.
- Plantillas bloqueadas con `teams.addGuard` mientras el equipo está inscrito.
- Tests: `tests/tournaments.test.js` (14), suite total 354/354; check, lint, verify-commands (45 comandos) y verify-deploy OK.
- **Implementado, pendiente de verificación con entorno real:** entrega de anuncios y menciones en grupos reales de WhatsApp.

## Fase 8 — ELO, rankings y competitivo (completada)

- `src/services/elo.js` (`EloService`): ELO real (K variable, provisional los primeros 10 partidos) para jugadores y equipos, calculado solo con partidas finalizadas con resultado real (`matchFinished`). Cada jugador compara el ELO medio de su plantilla congelada con el del rival.
- Idempotencia: cada partida (id único) se aplica una sola vez (`applied`, persistente); partidas canceladas/sin resultado no puntúan. Antiabuso: tras 4 partidas entre los mismos equipos en 24 h el resultado se registra pero no puntúa (`ELO_MAX_PAIR_PER_DAY`).
- Temporadas: `.temporada cerrar` (SUPERADMIN) guarda el podio, reparte monedas virtuales (300/200/100 por defecto), aplica reinicio suave del ELO y abre la siguiente; solo cuentan jugadores con partidas esa temporada; emite `seasonClosed`.
- Comandos: `.elo [@u]` (+ `historial`), `.ranking` (elo, victorias, xp, niveles, monedas, juegos, equipos, clanes; alias `.top`), `.rival`, `.comparar` (jugador, equipo), `.temporada` (historial, cerrar). Los rankings de clan son la media del ELO de los equipos del clan (equipos creados en el grupo del clan).
- Tests: `tests/elo.test.js` (9). Suite total 363/363; check, lint, verify-commands (50 comandos) y verify-deploy OK. Persistencia y reinicio verificados (ELO, partidas aplicadas, temporadas).
- Sin dependencia de WhatsApp real ni de APIs externas (todo calculado con datos locales).

## Fase 9 — Administración, moderación y sistema social (completada)

**Moderación (18 comandos, categoría moderacion):** warn, unwarn, warns, warnlist, mute, unmute, antilinks, antispam, antiflood, welcome, goodbye, tagall, hidetag, admins, groupinfo, grupoconfig (maxwarns, warnaccion, flood, spam), permisos, modlogs. `src/services/groups.js` + `src/plugins/moderacion`.
- Permisos reales: el rol ADMIN sale de los metadatos reales del grupo; nunca se supone. No se puede sancionar al OWNER, al bot, a admins del grupo ni a roles iguales o superiores.
- Acciones que dependen de que el bot sea administrador (mute, antilinks, antispam, antiflood, warnaccion kick): se comprueba con los metadatos reales y, si no lo es, devuelven un error claro y NO se activan. Si el bot pierde el admin con la protección activa, no se sanciona (no se puede borrar) y se registra un aviso.
- Moderación automática en el dispatcher (antes de los comandos; exentos OWNER, MOD+ y admins del grupo); un silenciado no puede usar comandos. Bienvenida/despedida por el evento `group-participants` (con deduplicación de eventos repetidos).
- Registro de moderación por grupo en auditoría (`modlogs`).

**OWNER (24 comandos, categoría owner):** botinfo, statsbot, botstatus, uptime, grupos (alias listagrupos), grupoinfo, broadcast (+ confirmar, cancelar), backup, backups, restore, reload, plugins, plugininfo, mantenimiento, banuser, unbanuser, addadmin, deladmin, addmod, delmod, dbstats, apistatus, logs, errors. `src/services/admin.js` + `src/plugins/owner`.
- Broadcast: recorre los grupos consultados a WhatsApp en ese momento (`groupFetchAllParticipating`), nunca IDs inventados; solo envía donde el bot puede escribir (grupos "solo admins" se omiten si el bot no es admin); vista previa + `broadcast confirmar` (vence en 2 min, se consume antes de enviar → no se duplica), pausa configurable entre grupos (`BROADCAST_DELAY_MS`), informe de enviados/omitidos/fallidos y auditoría.
- Modo mantenimiento persistente (solo el OWNER usa comandos). `restore` exige "confirmar" y hace antes un backup `prerestore`. `reload` vacía cachés, re-sincroniza trabajos del scheduler y guarda datos; NO recarga código ni `.env` (requiere reiniciar). `apistatus` solo muestra nombres/estado, nunca claves ni URLs. `errors` usa un búfer en memoria del logger (sin trazas).

**Social (6 comandos, categoría social + extensión de `comparar`/`perfil`):** amigos (agregar, aceptar, rechazar, eliminar, solicitudes), logros, medallas, titulos (equipar, quitar), insignias, estadisticas (alias stats), `comparar perfil`. `src/services/social.js` + `src/plugins/social`. Logros, medallas e insignias se calculan SOLO con datos reales (nivel, victorias, ELO, torneos ganados según la final real, podios de temporada, juegos, amistades, verificación FF); los logros se desbloquean una sola vez (idempotente). El perfil muestra título, insignias, amigos y logros.

**Seguridad:** USER/ADMIN no pueden ejecutar comandos OWNER (probado en los 27 usos), rate limit por comando, validación de entradas, protección de duplicados (dispatcher), auditoría de todas las acciones, sin secretos en respuestas/logs.

**Tests:** `tests/moderation.test.js` (7), `tests/admin.test.js` (11), `tests/social.test.js` (4). Suite total 385/385; check, lint, verify-commands (98 comandos) y verify-deploy OK. Persistencia/reinicio verificados (configuración de grupos, advertencias, mantenimiento, amistades).

**Implementado, pendiente de verificación con entorno real de WhatsApp:** borrado real de mensajes (`sendMessage {delete}`), expulsión (`groupParticipantsUpdate remove`), `groupFetchAllParticipating` (campos `announce`, `participants.admin`), formato real de `group-participants.update` (bienvenida/despedida) y de los metadatos (`id`/`lid`/`phoneNumber`) para reconocer al bot como admin, menciones masivas (tagall/hidetag), entrega real del broadcast. Todo está probado contra un WhatsApp simulado, no contra WhatsApp real.

## Fase 4 — resumen (GDC)
**Verificación final:** `npm test` → 305 tests, 305 OK (262 previos intactos + 42 de GDC + 1 de scheduler);
`npm run check` OK (71 archivos); `npm run lint` OK; `verify-commands` OK (26 comandos; cada subcomando de `.gdc` tiene
handler y está citado en tests).

**Implementado**
- Subcomandos en el registro central (`subcommands`): cada uno con handler, permisos (`permissionsWithArgs` para
  "ver = USER / cambiar = ADMIN"), ámbito y registro; el dispatcher los resuelve y valida. Un subcomando sin handler
  hace fallar el registro → no puede existir un comando GDC sin implementación. `.help`, `.menu` y `COMMANDS.md` los listan.
- `src/services/gdc.js` + `src/services/gdc-messages.js` + `src/plugins/gdc/index.js` (26 subcomandos): ayuda, estado,
  config, equipos, equipo, miembros, crear, unirse, salir, expulsar, cerrar, abrir, invitar, aceptar, rechazar, historial,
  resultado, finalizar, activar, desactivar, hora, recordatorio, placas, honor, reglas, admin.
- GDC independiente por grupo/clan verificado; sin clan → aviso estándar con `.verificarclan IDCLAN`.
- Zona America/Guayaquil; hora por defecto 19:00 y recordatorio 10 min antes (18:50), configurables y persistentes por grupo.
- Escuadras de EXACTAMENTE 4 (estados 1/4…4/4 "ESCUADRA COMPLETA"); un usuario solo en una escuadra en TODOS los grupos;
  invitaciones con vigencia (`GDC_INVITE_TTL_MINUTES`); escuadras caducadas/archivadas (`GDC_SQUAD_TTL_HOURS`, al finalizar o
  al desverificar el clan). Solo placas obligatorias (`.gdc placas NUMERO|borrar`), sin mínimos ni máximos.
- Honor opcional por clan (activar/desactivar + valor requerido). El bot NO lo valida: lo dice explícitamente (requiere API compatible).
- Resultados manuales (victoria/derrota/empate/cancelada) e historial limitado (`GDC_HISTORY_KEEP`). Nada se inventa.
- Auditoría de acciones importantes en el documento del grupo (`audit`).
- Scheduler: trabajos `GDC_REM_<grupo>_<fecha>_<hora>` y `GDC_START_<grupo>_<fecha>_<hora>`; `syncGroup`/`syncAll`
  reconcilian sin duplicar; el recordatorio se envía aunque no haya escuadras; idempotencia por id del scheduler +
  `sent.reminder/start`; reintentos si falla el envío; "sending" interrumpido NO se reenvía.
- Menciones solo con JIDs reales (escuadras primero, luego participantes reales del grupo, sin el bot, tope `GDC_MAX_MENTIONS`);
  si `groupMetadata` falla, el aviso sale igual mencionando solo a las escuadras.
- Integración con `.menu` dinámico (próxima GDC, placas, escuadras) y con `.setclan hora|recordatorio|gdc`.

**Probado (automático, con WhatsApp simulado)**
- Validaciones y permisos de todos los subcomandos, reglas de escuadra, invitaciones, resultados, historial, auditoría, menú.
- Scheduler: ids únicos, reprogramación por cambio de hora/recordatorio/activar/desactivar/desverificar, un grupo no afecta a otro.
- Reinicio y recuperación: persistencia de escuadras/configuración/avisos; caída dentro de la gracia (se envía una vez);
  fuera de la gracia (perdido, no se envía, se programa el día siguiente); recordatorio perdido pero inicio dentro de gracia;
  interrumpido durante el envío (no se reenvía); aviso ya enviado (no se repite); `syncAll` repone trabajos; clan desactivado.
- Cableado real de `createApp` (`gdc.syncAll()` tras cargar la base).

**NO probado / depende de WhatsApp o APIs reales**
- Que `groupMetadata` real traiga `phoneNumber`/`lid` como se asume y que WhatsApp muestre las menciones.
- Puntualidad real de los avisos 24/7 (temporizadores del proceso reales, relojes del servidor).
- Validación automática del honor: no existe (no hay API compatible configurada).
- Botones interactivos: Fase 11. No se controla Free Fire.

**Errores encontrados y corregidos en la Fase 4**
- `syncAll()` al arrancar cancelaba avisos vencidos antes de que el scheduler pudiera recuperarlos (se perdía la
  recuperación tras un reinicio). Ahora se conservan los vencidos con configuración vigente.
- Un trabajo cancelado bloqueaba reprogramar el mismo id: `.gdc desactivar` + `.gdc activar` el mismo día dejaba la GDC sin
  avisos. El scheduler ahora revive los cancelados; los ya ejecutados siguen siendo idempotentes.
- Errores de aserción en 3 tests (formato de negritas, `.help` de categoría vs. comando).

## Fase 3 — resumen (clanes + menú dinámico)
**Implementado**
- `src/providers/lookup-service.js`: el servicio multi-API (fallback, timeout, cache, circuit breaker, errores
  diferenciados) se generalizó; `FreeFireService` y el nuevo `ClanApiService` son subclases finas.
- `src/providers/clans/{normalize,service}.js`: APIs de clanes por plantilla `CLAN_API_URLS` (`{id}`, `{region}`, `{key}`;
  `CLAN_API_KEY` solo viaja a URLs con `{key}` y NO se reutiliza `FF_API_KEY`). Región opcional. Normalizador tolerante:
  solo devuelve nombre, nivel, miembros, capacidad, líder, lista de miembros, puntuación, descripción, región y fecha
  de creación cuando la API los entrega; rechaza respuestas con otro ID.
- `src/services/clans.js`: un grupo = un clan y un clan activo = un grupo; configuración POR CLAN (GDC on/off, hora
  19:00 por defecto, aviso 10 min → 18:50, honor on/off, honor requerido; escuadras de 4 y placas obligatorias son fijas),
  reglas, descripción, historial (máx. 100 + `logs`), ranking. Desverificar conserva todo y se restaura al volver a verificar.
- Comandos de clan (14): `.verificarclan` (ADMIN, grupo; verifica contra la API real: si la API está caída o no
  configurada NO se verifica), `.desverificarclan`, `.clan`/`claninfo`/`clanperfil` (del grupo o por ID), `.clanmiembros`
  (paginado), `.clanlider`, `.clanstats` (alias `clannivel`, `clanxp`), `.clanconfig` + `.setclan` (ADMIN),
  `.clanreglas` + `.setclanreglas` (ADMIN), `.clandesc` + `.setclandesc` (ADMIN), `.clanhistorial`/`clanlog` (ADMIN),
  `.topclanes` (alias `clantop`, `clanranking`), `.clancomparar` (alias `clanversus`).
- `.menu` dinámico: mención real de quien lo usa, bloque de usuario (registrado o no, rol), bloque de clan (aviso
  "CLAN NO VERIFICADO" + `.verificarclan IDCLAN`; o nombre, ID, datos reales, config de GDC/honor), comandos filtrados por
  rol. El estado/próxima GDC solo aparece si existe `services.gdc.menuLines` (Fase 4): nunca se inventa.
- `npm run clan-probe -- IDCLAN [REGION] --raw` prueba tus APIs de clanes sin iniciar el bot.

**Comandos de clan de la especificación que NO se registraron (a propósito, sin datos reales o dependen de otra fase)**
`.clanbuscar` (necesita una API de búsqueda), `.clanroles`, `.clanbanner`, `.claninvitacion`, `.clanmiembrosonline`
(WhatsApp no da presencia fiable), `.clanactividad` (necesita contadores por grupo), `.clanentrada`/`.clansalida`
(Fase 10, eventos de entrada/salida), `.clanbattle`/`.clanevento` (Fases 4–5). Se añadirán cuando haya fuente real; no hay
comandos de relleno.

## Limitaciones del entorno de desarrollo (qué NO se ha podido verificar)
- El registro de npm devuelve 403 desde este entorno: `@whiskeysockets/baileys` NO está instalado aquí y
  no existe `package-lock.json`. Se genera al ejecutar `npm install` con red; hay que versionarlo.
- Baileys solo se probó contra un Baileys simulado. No hay WhatsApp real ni Internet hacia APIs de Free Fire.
- No hay daemon de Docker (imagen sin construir), ni PM2, ni Termux real: solo se validan por script los archivos.

## 1. Implementado en la Fase 2
- **Registro central de comandos** (`src/commands/registry.js`): name, aliases, description, usage, example, category,
  permissions, cooldown, handler, scope (`any|group|private`), requiresRegistration. Valida la definición y rechaza
  conflictos de nombre/alias. Es la única fuente de verdad: dispatcher, `.help` y `COMMANDS.md` leen de él.
- **Dispatcher** (`src/handlers/dispatcher.js`): parseo del mensaje → ignora propios/estado/duplicados/antiguos
  (`MAX_MESSAGE_AGE_SECONDS`, evita ejecutar comandos atrasados al reconectar) → comando desconocido ignorado →
  baneado ignorado → alcance → rol → registro → rate limit → handler. `UserError` muestra su mensaje; cualquier otro
  error muestra un texto genérico (sin detalles internos) y se registra en el log. Los rechazos se responden como
  mucho 1 vez/15 s por persona. Apagado: `stop()` + `drain()` antes de cerrar scheduler/WhatsApp.
- **Permisos** (`src/middleware/permissions.js`): USER < MOD < ADMIN < SUPERADMIN < OWNER. OWNER por número
  (593990192338 por defecto, también si llega como `@lid` con número alterno), roles guardados en BD, admin del grupo de
  WhatsApp = ADMIN solo dentro de ese grupo (metadatos con cache de 60 s; si no se pueden consultar, NO se concede).
- **Rate limit** (`src/middleware/ratelimit.js`): ventana por usuario y por grupo + cooldown por comando; aviso una sola vez;
  OWNER exento.
- **Usuarios** (`src/services/users.js`): registro persistente con recompensa una sola vez, XP/niveles (1–100),
  monedas virtuales con historial, XP por actividad con cooldown anti-farm, vínculo de UID único por persona,
  alias de identidad (número / `@lid`) para reconocer a la misma persona.
- **Free Fire** (`src/providers/freefire/*`): varias APIs por plantilla (`{uid}`, `{region}`, `{key}`), timeout por API,
  tope de 1 MiB, fallback, circuit breaker, cache positiva/negativa, coalescencia de peticiones, sondeo de región,
  rechazo de respuestas con otro UID. Distingue NOT_FOUND / REGION_ERROR / API_DOWN / NOT_CONFIGURED / RATE_LIMITED /
  INVALID_RESPONSE. El normalizador solo devuelve campos presentes y válidos (no inventa nivel, rango, likes, avatar ni
  banner; los códigos de rango se muestran como "código", sin traducir). `npm run ff-probe -- UID [REGION] --raw`
  prueba tus APIs reales sin iniciar el bot. La clave solo se envía a URLs con `{key}` y nunca se registra.
- **Comandos de la Fase 2** (9; hoy el total es 25, ver `COMMANDS.md`, generado desde el registro): `.registro` (alias registrar, register), `.vincular`
  (link), `.desvincular` (unlink), `.perfil` (miperfil, profile; propio / mención / respuesta / UID), `.balance`
  (monedas, saldo), `.nivel` (xp, level), `.ff` (freefire), `.fffull`, `.help` (ayuda, comandos; categorías, categoría,
  detalle, filtrado por rol).
- **Vincular**: UID verificado si una API lo confirma; rechazado si la respuesta es definitiva "no existe" o la región
  es inválida; si la API está caída/sin configurar/resultado no definitivo se vincula SIN verificar y se avisa;
  `.perfil` refresca la ficha si tiene más de 6 h (si la API falla conserva la anterior).
- **Verificación de comandos** (`scripts/verify-commands.js`, dentro de `npm run check`): definiciones completas,
  uso/ejemplo coherentes, cada comando aparece en tests, `COMMANDS.md` al día (`npm run docs:commands` lo regenera).
- Otros: bus de eventos (`src/events/bus.js`), validadores (`src/utils/validators.js`), `src/utils/text.js`,
  `selfLid` en la conexión, número de comandos en `/status`.

## 2. Probado (automático)
`npm test` (Fase 2): 240 pasaban (Fase 1/24-7: 96 · Fase 2: 144). Ver el total actualizado más abajo.

| Archivo | Tests | Cubre |
|---|---|---|
| phase1 / connection / scheduler / health / process / deploy | 27 / 15 / 21 / 7 / 5 / 21 | Fase 1 y 24/7 (procesos reales, scheduler sin duplicados, despliegue) |
| registry | 37 | registro de comandos, permisos, rate limit |
| users | 17 | registro, XP, niveles, monedas, vínculos, persistencia |
| freefire | 52 | normalizador, fallback, cache, breaker, errores, seguridad de la clave (servidores HTTP locales reales) |
| dispatcher | 34 | integración con WhatsApp simulado: flujo registro→perfil→balance→nivel, permisos (owner, rol, admin de grupo), baneo, alcance, límites, errores, filtros de entrada, apagado, vincular/desvincular, perfil, ff, help, ensamblado en `createApp` |
| commands | 4 | contrato de plugins, conflictos, `COMMANDS.md` |

`npm run check` y `npm run lint`: OK.

Fase 3: **262 pasan en total** (+22 en `tests/clans.test.js`: normalizador, servicio de API con servidores simulados,
persistencia y restauración, conflictos, todos los comandos de clan con WhatsApp simulado, refresco de fichas, menú).
`tests/harness.js` es el stack de integración compartido.

## 3. NO probado
- Carga alta real (cientos de mensajes/s) y fugas de memoria a largo plazo.
- Comportamiento con grupos muy grandes (el metadato se consulta solo cuando un comando exige rol > USER).
- Formatos reales de las APIs de Free Fire: el normalizador es heurístico y solo se probó con respuestas simuladas.
- Un `@lid` que nunca se ha visto junto a su número no se puede asociar a un usuario ya registrado hasta que llegue un
  mensaje con ambos identificadores (limitación de WhatsApp).

## 4. Pendiente de verificar con red real / WhatsApp real
1. `npm install` y generar `package-lock.json`.
2. Pairing Code y reconexión reales; campos reales de `key.participant`, `participantAlt`, `participantPn`,
   `remoteJidAlt` y de `groupMetadata().participants` (`id`, `lid`, `phoneNumber`, `admin`).
3. Que las menciones (`contextInfo.mentionedJid`) y el citado lleguen como espera `parseIncoming`; envío con `quoted`.
4. APIs de Free Fire y de clanes reales: `npm run ff-probe -- UID REGION --raw` y `npm run clan-probe -- IDCLAN --raw`; ajustar `FF_API_URLS`/`CLAN_API_URLS`/regiones. El normalizador de clanes es heurístico y solo se probó con respuestas simuladas.
5. `docker compose up -d --build`, `pm2 start ecosystem.config.js`, `bash install-termux.sh`.
6. Botones interactivos y envío de medios en la versión de Baileys instalada (Fases 10-11).

## 5. Errores encontrados y corregidos en la Fase 2
- Servicio FF omitía APIs sin región tras un fallo de otra (bandera global) → conjunto por proveedor.
- Posibles falsos positivos del normalizador ("competitive" ~ "pet") → coincidencia por prefijo/sufijo.
- `drain()` del dispatcher usaba un temporizador `unref`: con un comando colgado el proceso podía terminar sin esperar
  → temporizador normal (el apagado ya tiene salida forzada a los 15 s).
- Un usuario que escribe a veces con número y a veces con `@lid` se trataba como dos personas → alias de identidad.
- Mensajes antiguos entregados al reconectar podían ejecutar comandos atrasados → filtro por antigüedad.
- Tests: precedencia string+boolean en una aserción, mock con UID fijo contra la guarda de UID distinto, límite por
  usuario consumido por intentos denegados, avisos de rechazo limitados (el test ahora lo respeta), base de datos
  sin cargar en el test de `createApp`; lint: la palabra "TODO" en un comentario en español.

## 5b. Errores encontrados y corregidos en la Fase 3
- Solo errores de tests (no de código): alias que comparten cooldown con su comando principal, límite por usuario de 8/10 s
  agotado en tests largos, cooldown de `.verificarclan` entre grupos, una aserción mal escrita. El refactor del servicio
  de APIs se validó con los 52 tests de Free Fire sin cambios.

## 6. Notas de diseño a recordar
- Si WhatsApp devuelve `loggedOut`, el proceso NO sale: queda vivo sin reconectar y `/ready` da 503.
  Hay que borrar `data/session/` y reiniciar para emparejar de nuevo.
- Los avisos de GDC deben usar `scheduler.scheduleDaily` con `offsetMinutes: -10` para el recordatorio y un trabajo
  aparte para las 19:00; el handler debe LANZAR un error si no pudo enviar (así se reintenta).
- `FF_API_URLS` y `CLAN_API_URLS` se separan por comas: una URL no puede contener comas (usa `%2C`).
- Los handlers pueden devolver un texto o `{ text, mentions }`. Para añadir comandos: crear un plugin en `src/plugins/`,
  añadirlo a `src/plugins/index.js`, probarlo y ejecutar `npm run docs:commands`.

## 7. Siguiente paso
El desarrollo está cerrado. Siguiente trabajo recomendado (con Internet y WhatsApp reales): `npm install`, emparejar el bot, ejecutar `npm run ff-probe`/`clan-probe` y `.apistatus probar`, anotar resultados en `docs/API_PROVIDERS.md` y validar la lista de la tabla "NO probado".
