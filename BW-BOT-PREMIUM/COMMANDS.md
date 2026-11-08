# Comandos de BW BOT PREMIUM

> Archivo generado automáticamente desde el registro de comandos (`npm run docs:commands`).
> No lo edites a mano: `npm run check` falla si no coincide con el código.

Prefijo por defecto: `.` (configurable con `BOT_PREFIX`). Total de comandos: **139**.

Roles de menor a mayor: USER < MOD < ADMIN < SUPERADMIN < OWNER. Un rol superior puede usar los comandos de los inferiores.

## general

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.help` | `.ayuda` `.comandos` | USER | 0 s | grupo y privado | Lista las categorías de comandos, los comandos de una categoría o el detalle de un comando. | `.help [categoría \| comando]` | `.help perfil` |
| `.menu` | `.inicio` | USER | 0 s | grupo y privado | Menú del bot según tu usuario, el grupo, su clan y tus permisos. Con una categoría lista sus comandos. | `.menu [categoría]` | `.menu clanes` |

## usuario

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.desvincular` | `.unlink` | USER | 5 s | grupo y privado, requiere registro | Quita el UID de Free Fire vinculado a tu perfil. | `.desvincular` | `.desvincular` |
| `.nivel` | `.xp` `.level` | USER | 3 s | grupo y privado, requiere registro | Muestra tu nivel, tu XP y lo que falta para subir. | `.nivel` | `.nivel` |
| `.perfil` | `.miperfil` `.profile` | USER | 5 s | grupo y privado | Muestra tu perfil o el de otra persona (menciónala o responde a su mensaje). Con un UID consulta ese jugador de Free Fire. | `.perfil [@usuario \| UID [REGION]]` | `.perfil @usuario` |
| `.registro` | `.registrar` `.register` | USER | 5 s | grupo y privado | Crea tu perfil en el bot y recibe tu recompensa de bienvenida. Opcionalmente vincula tu UID de Free Fire. | `.registro [UID] [REGION]` | `.registro 123456789 sa` |
| `.vincular` | `.link` | USER | 10 s | grupo y privado, requiere registro | Vincula tu UID de Free Fire a tu perfil. Si las APIs lo confirman queda verificado. | `.vincular UID [REGION]` | `.vincular 123456789 sa` |

## freefire

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.ff` | `.freefire` | USER | 8 s | grupo y privado | Consulta un jugador de Free Fire por UID usando las APIs configuradas. Sin UID usa el que tengas vinculado. Con "full" muestra más datos. | `.ff [UID] [REGION] [full]` | `.ff 123456789 sa` |
| `.fffull` | — | USER | 8 s | grupo y privado | Ficha completa de un jugador de Free Fire (todos los datos que entregue la API). | `.fffull [UID] [REGION]` | `.fffull 123456789 sa` |

## clanes

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.clan` | `.claninfo` `.clanperfil` | USER | 5 s | grupo y privado | Muestra el clan verificado de este grupo. Con un ID consulta cualquier clan en las APIs configuradas. | `.clan [IDCLAN] [REGION]` | `.clan` |
| `.clancomparar` | `.clanversus` `.clancompare` | USER | 10 s | grupo y privado | Compara dos clanes con los datos de la API. Con un solo ID compara el clan de este grupo contra ese. | `.clancomparar ID1 [ID2]` | `.clancomparar 1234567 7654321` |
| `.clanconfig` | `.configclan` | USER | 5 s | solo grupos | Muestra la configuración del clan de este grupo (GDC, hora, recordatorio, honor). Los administradores la cambian con setclan. | `.clanconfig` | `.clanconfig` |
| `.clandesc` | `.descclan` | USER | 5 s | solo grupos | Muestra la descripción del clan (la definida por los administradores o, si no hay, la de la API). | `.clandesc` | `.clandesc` |
| `.clanhistorial` | `.clanlog` | ADMIN | 5 s | solo grupos | Historial de cambios del clan de este grupo (verificación, configuración, reglas). Solo administradores. | `.clanhistorial [cantidad]` | `.clanhistorial 5` |
| `.clanlider` | `.lider` | USER | 5 s | solo grupos | Muestra el líder del clan según la API (solo si la API configurada lo entrega). | `.clanlider` | `.clanlider` |
| `.clanmiembros` | `.miembrosclan` | USER | 5 s | solo grupos | Lista los miembros del clan según la API (solo si la API configurada entrega la lista). | `.clanmiembros [pagina]` | `.clanmiembros 2` |
| `.clanreglas` | `.reglasclan` | USER | 5 s | solo grupos | Muestra las reglas del clan de este grupo. Los administradores las cambian con setclanreglas. | `.clanreglas` | `.clanreglas` |
| `.clanstats` | `.clanestadisticas` `.clannivel` `.clanxp` | USER | 5 s | solo grupos | Estadísticas del clan que entrega la API: nivel, puntuación, miembros y fecha de creación (solo los datos disponibles). | `.clanstats` | `.clanstats` |
| `.desverificarclan` | `.unverifyclan` | ADMIN | 10 s | solo grupos | Quita la verificación del clan de este grupo. La configuración, reglas e historial se conservan por si se vuelve a verificar. | `.desverificarclan` | `.desverificarclan` |
| `.setclan` | `.clanset` | ADMIN | 3 s | solo grupos | Cambia una opción del clan de este grupo: gdc, hora, recordatorio, honor, honorrequerido. | `.setclan opción valor` | `.setclan honorrequerido 100` |
| `.setclandesc` | — | ADMIN | 5 s | solo grupos | Define la descripción del clan de este grupo (hasta 200 caracteres). Con "borrar" la elimina. | `.setclandesc texto \| borrar` | `.setclandesc Clan competitivo de Ecuador` |
| `.setclanreglas` | — | ADMIN | 5 s | solo grupos | Define las reglas del clan de este grupo (hasta 600 caracteres). Con "borrar" las elimina. | `.setclanreglas texto \| borrar` | `.setclanreglas Respeto y puntualidad en la GDC` |
| `.topclanes` | `.clantop` `.clanranking` | USER | 10 s | grupo y privado | Ranking de los clanes verificados en este bot, por nivel (según los datos de la API). | `.topclanes` | `.topclanes` |
| `.verificarclan` | `.verifyclan` | ADMIN | 15 s | solo grupos | Asocia este grupo a un clan de Free Fire comprobando su ID en las APIs configuradas. No hace falta indicar región. | `.verificarclan IDCLAN [REGION]` | `.verificarclan 1234567` |

## gdc

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.gdc` | `.guerradeclanes` | USER | 2 s | solo grupos | Guerra de Clanes: panel, escuadras de 4, invitaciones, recordatorios automáticos, honor, placas, resultados e historial. Usa "gdc ayuda" para ver los subcomandos. | `.gdc [subcomando]` | `.gdc crear` |

### Subcomandos de `.gdc`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.gdc ayuda` | `help` | USER | — | Lista los subcomandos de la GDC disponibles para tu rol. | `.gdc ayuda` |
| `.gdc estado` | `status` | USER | — | Estado de la GDC: próxima hora, avisos enviados, placas, honor y escuadras. | `.gdc estado` |
| `.gdc config` | `configuracion` | USER | — | Configuración de la GDC de este grupo (hora, recordatorio, placas, honor). | `.gdc config` |
| `.gdc equipos` | `escuadras` | USER | — | Lista todas las escuadras de la GDC con sus miembros y cupos. | `.gdc equipos [pagina]` |
| `.gdc equipo` | `mi` `miescuadra` | USER | — | Muestra tu escuadra, o la escuadra con el número indicado. | `.gdc equipo [N]` |
| `.gdc miembros` | — | USER | — | Miembros de una escuadra (la tuya o la indicada) con su UID de Free Fire si lo vincularon. | `.gdc miembros [N]` |
| `.gdc crear` | `nueva` | USER + registro | — | Crea una escuadra nueva y te hace su capitán. | `.gdc crear` |
| `.gdc unirse` | `join` | USER + registro | — | Te une a una escuadra abierta que no esté completa. | `.gdc unirse N` |
| `.gdc salir` | `leave` | USER + registro | — | Sales de tu escuadra. Si eras el capitán, el cargo pasa al siguiente miembro. | `.gdc salir` |
| `.gdc expulsar` | `kick` | USER + registro | — | El capitán expulsa a un miembro de su escuadra (mencionándolo). Un administrador puede expulsar de cualquier escuadra. | `.gdc expulsar @usuario` |
| `.gdc cerrar` | — | USER + registro | — | Cierra tu escuadra: solo se entra por invitación. Un administrador indica el número. | `.gdc cerrar [N]` |
| `.gdc abrir` | — | USER + registro | — | Abre tu escuadra para que cualquiera se una con unirse. Un administrador indica el número. | `.gdc abrir [N]` |
| `.gdc invitar` | `invite` | USER + registro | — | El capitán invita a una persona registrada (mencionándola) a su escuadra. | `.gdc invitar @usuario` |
| `.gdc aceptar` | `accept` | USER + registro | — | Acepta una invitación vigente a una escuadra (la más reciente, o la del número indicado). | `.gdc aceptar [N]` |
| `.gdc rechazar` | `reject` | USER + registro | — | Rechaza una invitación vigente a una escuadra. | `.gdc rechazar [N]` |
| `.gdc historial` | `history` | USER | — | Historial de GDC finalizadas: fecha, escuadras y resultado registrado por los administradores. | `.gdc historial [cantidad]` |
| `.gdc resultado` | `result` | USER | ADMIN | Muestra el resultado de la GDC en curso. Un administrador lo registra a mano: resultado victoria\|derrota\|empate\|cancelada [nota]. | `.gdc resultado [victoria\|derrota\|empate\|cancelada] [nota]` |
| `.gdc finalizar` | `finish` | ADMIN | — | Cierra la GDC en curso: guarda escuadras y resultado en el historial y limpia las escuadras. Opcional: resultado y nota. | `.gdc finalizar [victoria\|derrota\|empate\|cancelada] [nota]` |
| `.gdc activar` | — | ADMIN | — | Activa la GDC de este clan (se programan el recordatorio y el inicio). | `.gdc activar` |
| `.gdc desactivar` | — | ADMIN | — | Desactiva la GDC de este clan (se cancelan los avisos programados). | `.gdc desactivar` |
| `.gdc hora` | `time` | USER | ADMIN | Muestra la hora de la GDC; con HH:MM un administrador la cambia (por defecto 19:00). | `.gdc hora [HH:MM]` |
| `.gdc recordatorio` | `aviso` | USER | ADMIN | Muestra los minutos de aviso previo; con un número (1-120) un administrador los cambia (por defecto 10). | `.gdc recordatorio [MINUTOS]` |
| `.gdc placas` | — | USER | ADMIN | Muestra las placas obligatorias; con un número un administrador las define, y con "borrar" las quita. No hay mínimos ni máximos de placas. | `.gdc placas [NUMERO\|borrar]` |
| `.gdc honor` | — | USER | ADMIN | Muestra la configuración de honor del clan; un administrador usa activar, desactivar o un NUMERO requerido. | `.gdc honor [activar\|desactivar\|NUMERO]` |
| `.gdc reglas` | `rules` | USER | — | Reglas de la GDC según la configuración del clan, más las reglas escritas por los administradores. | `.gdc reglas` |
| `.gdc admin` | — | ADMIN | — | Panel de administración de la GDC: subcomandos de admin y últimas acciones auditadas. | `.gdc admin` |

## equipos

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.equipo` | `.team` `.equipos` | USER | 2 s | grupo y privado | Equipos 2v2, 4v4 y 6v6: crear, invitar, capitán/subcapitán, miembros, estadísticas, historial, ranking y enfrentamientos. | `.equipo [subcomando]` | `.equipo crear 4v4 Los Pro` |
| `.partida` | `.match` `.partidas` | USER | 2 s | grupo y privado | Partidas entre equipos: crear, abrir, unirse, iniciar, reportar resultado, resolver disputas y cancelar. Estados reales, sin resultados inventados. | `.partida [subcomando]` | `.partida lista` |

### Subcomandos de `.equipo`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.equipo crear` | `create` | USER + registro | — | Crea un equipo 2v2, 4v4 o 6v6 del que eres capitán. Un jugador solo puede estar en un equipo por modalidad. | `.equipo crear MODO NOMBRE` |
| `.equipo info` | `ver` | USER | — | Información de un equipo (por ID o nombre). Sin argumentos muestra tus equipos. | `.equipo info [ID\|nombre]` |
| `.equipo miembros` | `members` | USER | — | Lista los miembros de un equipo con su cargo (capitán, subcapitán, jugador). | `.equipo miembros [ID\|nombre]` |
| `.equipo invitar` | `invite` | USER + registro | — | El capitán o subcapitán invita a una persona registrada (mencionándola) a su equipo. | `.equipo invitar @usuario [modo]` |
| `.equipo aceptar` | `accept` | USER + registro | — | Acepta una invitación vigente a un equipo (indica el ID si tienes varias). | `.equipo aceptar [ID]` |
| `.equipo rechazar` | `reject` | USER + registro | — | Rechaza una invitación vigente a un equipo. | `.equipo rechazar [ID]` |
| `.equipo invitaciones` | `invites` | USER + registro | — | Muestra las invitaciones de equipo que tienes pendientes. | `.equipo invitaciones` |
| `.equipo salir` | `leave` | USER + registro | — | Sales de tu equipo. Si eras el capitán, el cargo pasa al subcapitán o al siguiente miembro. | `.equipo salir [modo]` |
| `.equipo expulsar` | `kick` | USER + registro | — | El capitán o subcapitán expulsa a un miembro (mencionándolo). No se puede expulsar al capitán. | `.equipo expulsar @usuario [ID]` |
| `.equipo capitan` | `captain` | USER + registro | — | El capitán traspasa el cargo a otro miembro del equipo (mencionándolo). | `.equipo capitan @usuario [modo]` |
| `.equipo subcapitan` | `vice` | USER + registro | — | El capitán nombra subcapitán a un miembro (mencionándolo) o quita el cargo con "quitar". | `.equipo subcapitan @usuario\|quitar [modo]` |
| `.equipo renombrar` | `rename` | USER + registro | — | El capitán cambia el nombre de su equipo (indicando su ID). | `.equipo renombrar ID NUEVO_NOMBRE` |
| `.equipo disolver` | `disband` | USER + registro | — | El capitán disuelve su equipo (indicando su ID). No se puede mientras esté en una partida llena o iniciada. | `.equipo disolver ID` |
| `.equipo stats` | `estadisticas` | USER | — | Estadísticas de un equipo: partidas, victorias, derrotas, empates, % y racha. Solo cuenta partidas finalizadas. | `.equipo stats [ID\|nombre]` |
| `.equipo historial` | `history` | USER | — | Últimas partidas finalizadas de un equipo. | `.equipo historial [ID\|nombre]` |
| `.equipo ranking` | `top` | USER | — | Ranking de equipos por victorias (opcionalmente de una modalidad). Solo cuenta partidas finalizadas. | `.equipo ranking [modo]` |
| `.equipo vs` | `enfrentamientos` | USER | — | Enfrentamientos directos entre dos equipos (el tuyo y otro, o dos indicados). | `.equipo vs ID_A [ID_B]` |

### Subcomandos de `.partida`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.partida crear` | `create` | USER + registro | — | El capitán o subcapitán crea una partida con su equipo completo (estado pendiente). Con un ID de rival es un desafío directo. | `.partida crear [ID_RIVAL]` |
| `.partida abrir` | `open` | USER + registro | — | El anfitrión abre la partida para que un equipo rival se una (pendiente → abierta). | `.partida abrir ID` |
| `.partida unirse` | `join` | USER + registro | — | El capitán o subcapitán de un equipo completo se une como rival a una partida abierta (abierta → llena). | `.partida unirse ID` |
| `.partida retirar` | `withdraw` | USER + registro | — | El equipo rival se retira de una partida llena que aún no empezó (vuelve a abierta). | `.partida retirar ID` |
| `.partida iniciar` | `start` | USER + registro | — | Un capitán o un administrador inicia una partida llena (llena → iniciada). Se vuelve a comprobar que los equipos estén completos. | `.partida iniciar ID` |
| `.partida resultado` | `result` | USER + registro | — | Un capitán reporta el resultado desde SU equipo. Si los dos capitanes coinciden se finaliza; si no, queda en disputa para un administrador. | `.partida resultado ID victoria\|derrota\|empate` |
| `.partida resolver` | `resolve` | ADMIN + registro | — | Un administrador fija el resultado de una partida iniciada (A = anfitrión, B = rival, o empate). Resuelve disputas. | `.partida resolver ID A\|B\|empate` |
| `.partida cancelar` | `cancel` | USER + registro | — | El anfitrión (o un administrador) cancela una partida que no terminó. Una iniciada solo la cancela un administrador. | `.partida cancelar ID [motivo]` |
| `.partida info` | `ver` | USER | — | Estado y detalles de una partida. | `.partida info ID` |
| `.partida lista` | `abiertas` | USER | — | Partidas abiertas esperando rival. | `.partida lista` |
| `.partida mias` | `mine` | USER + registro | — | Tus partidas sin terminar (de los equipos a los que perteneces). | `.partida mias` |

## torneos

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.torneo` | `.tournament` `.torneos` | USER | 2 s | grupo y privado | Torneos de eliminación entre equipos: crear, inscribir, check-in, cuadro, rondas, partidas, ganadores, premios, puntos y ranking. | `.torneo [subcomando]` | `.torneo lista` |

### Subcomandos de `.torneo`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.torneo crear` | `create` | ADMIN + registro | — | Un administrador crea un torneo de eliminación en el grupo (queda en borrador hasta abrirlo). | `.torneo crear MODO MAX_EQUIPOS NOMBRE` |
| `.torneo editar` | `edit` | ADMIN + registro | — | Edita un torneo en borrador o con inscripción abierta: nombre, max, premio (monedas por jugador campeón), puntos, inicio, cierre. | `.torneo editar ID campo valor` |
| `.torneo abrir` | `open` | ADMIN + registro | — | Abre la inscripción de un torneo en borrador. | `.torneo abrir ID` |
| `.torneo cerrar` | `close` | ADMIN + registro | — | Cierra la inscripción: empieza la fase de check-in. | `.torneo cerrar ID` |
| `.torneo cancelar` | `cancel` | ADMIN + registro | — | Cancela un torneo (y sus partidas pendientes). | `.torneo cancelar ID [motivo]` |
| `.torneo eliminar` | `delete` | ADMIN + registro | — | Elimina un torneo en borrador o cancelado. | `.torneo eliminar ID` |
| `.torneo inscribir` | `unirse` `join` | USER + registro | — | El capitán o subcapitán inscribe a su equipo completo en un torneo con inscripción abierta. | `.torneo inscribir ID [equipo]` |
| `.torneo salir` | `leave` | USER + registro | — | Retiras a tu equipo de un torneo (solo antes de que empiece). | `.torneo salir ID [equipo]` |
| `.torneo participantes` | `equipos` `teams` | USER | — | Equipos inscritos en un torneo, con su capitán y check-in. | `.torneo participantes ID` |
| `.torneo checkin` | — | USER + registro | — | El capitán confirma la presencia de su equipo (necesario para jugar). | `.torneo checkin ID [equipo]` |
| `.torneo checkout` | — | USER + registro | — | El capitán retira la confirmación de presencia de su equipo. | `.torneo checkout ID [equipo]` |
| `.torneo iniciar` | `start` | ADMIN + registro | — | Inicia el torneo con los equipos que hicieron check-in y genera el cuadro (usa "sorteo" para mezclar el orden). | `.torneo iniciar ID [sorteo]` |
| `.torneo bracket` | `llaves` `cuadro` | USER | — | Muestra el cuadro del torneo con los ganadores de cada partida. | `.torneo bracket ID` |
| `.torneo ronda` | `round` | USER | — | Partidas de una ronda del torneo (por defecto la actual). | `.torneo ronda ID [N]` |
| `.torneo partidas` | `matches` | USER | — | Partidas en juego del torneo (con su ID de partida para reportar resultados). | `.torneo partidas ID` |
| `.torneo proximos` | `upcoming` | USER | — | Torneos con fecha de inicio futura. | `.torneo proximos` |
| `.torneo historial` | `history` | USER | — | Últimos torneos finalizados con su campeón. | `.torneo historial` |
| `.torneo ganadores` | `winners` | USER | — | Campeones y subcampeones de los torneos finalizados. | `.torneo ganadores` |
| `.torneo premios` | `prizes` | USER | — | Premio configurado de un torneo y, si terminó, a quién se pagó. | `.torneo premios ID` |
| `.torneo puntos` | `points` | USER | — | Tabla de puntos de un torneo. | `.torneo puntos ID` |
| `.torneo ranking` | `top` | USER | — | Ranking global de equipos por puntos de torneos. | `.torneo ranking` |
| `.torneo stats` | `estadisticas` | USER | — | Estadísticas de torneos de un equipo (el tuyo si no indicas otro). | `.torneo stats [equipo]` |
| `.torneo descalificar` | `dq` | ADMIN + registro | — | Un administrador descalifica a un equipo de un torneo en curso (pierde por walkover). | `.torneo descalificar ID equipo` |
| `.torneo finalizar` | `finish` | ADMIN + registro | — | Un administrador finaliza un torneo cuya final ya tiene ganador (normalmente ocurre solo). | `.torneo finalizar ID` |
| `.torneo info` | `ver` | USER | — | Detalles de un torneo. | `.torneo info ID` |
| `.torneo lista` | `list` | USER | — | Torneos activos (borrador no se muestra) y recientes. | `.torneo lista` |

## scrims

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.scrim` | `.scrims` | USER | 2 s | grupo y privado | Scrims programados entre dos equipos: crear, unirse, check-in, resultado, ranking, estadísticas e historial. | `.scrim [subcomando]` | `.scrim lista` |

### Subcomandos de `.scrim`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.scrim crear` | `create` | USER + registro | — | El capitán o subcapitán programa un scrim con su equipo completo: indica la hora (HH:MM) o fecha y hora (AAAA-MM-DD HH:MM). | `.scrim crear HORA [modo]` |
| `.scrim info` | `ver` | USER | — | Detalles de un scrim. | `.scrim info ID` |
| `.scrim unirse` | `join` | USER + registro | — | El capitán o subcapitán de un equipo completo se une como rival a un scrim abierto. | `.scrim unirse ID` |
| `.scrim salir` | `leave` | USER + registro | — | El equipo rival se retira de un scrim lleno (vuelve a abierto). | `.scrim salir ID` |
| `.scrim equipos` | `teams` | USER | — | Equipos de un scrim con sus jugadores. | `.scrim equipos ID` |
| `.scrim lista` | `list` | USER | — | Scrims abiertos o programados, por orden de hora. | `.scrim lista` |
| `.scrim horario` | `hora` `when` | USER | — | Fecha y hora de un scrim y el tiempo que falta. | `.scrim horario ID` |
| `.scrim checkin` | — | USER + registro | — | Cada capitán confirma su presencia (desde unos minutos antes). Cuando ambos lo hacen se crea la partida. | `.scrim checkin ID` |
| `.scrim resultado` | `result` | USER + registro | — | Cada capitán reporta el resultado desde SU equipo; si coinciden se finaliza, si no queda en disputa. | `.scrim resultado ID victoria\|derrota\|empate` |
| `.scrim resolver` | `resolve` | ADMIN + registro | — | Un administrador fija el resultado de un scrim en curso (A = anfitrión, B = rival, o empate). | `.scrim resolver ID A\|B\|empate` |
| `.scrim ranking` | `top` | USER | — | Ranking de equipos por puntos de scrims (victoria 3, empate 1). | `.scrim ranking` |
| `.scrim estadisticas` | `stats` | USER | — | Estadísticas de scrims de un equipo (el tuyo si no indicas otro). | `.scrim estadisticas [equipo]` |
| `.scrim cancelar` | `cancel` | USER + registro | — | El anfitrión (o un administrador) cancela un scrim. En curso solo un administrador. | `.scrim cancelar ID [motivo]` |
| `.scrim historial` | `history` | USER | — | Últimos scrims finalizados o cancelados (de un equipo si lo indicas). | `.scrim historial [equipo]` |

## juegos

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.adivina` | `.numero` | USER | 2 s | solo grupos, requiere registro | Adivina el número secreto del 1 al 100: el bot dice "mayor" o "menor". Gana quien lo acierte (máx. 5 intentos por persona). | `.adivina [NUMERO]` | `.adivina 50` |
| `.anagrama` | — | USER | 2 s | solo grupos, requiere registro | Ordena las letras para formar la palabra. Gana la primera persona que la escriba bien. | `.anagrama [PALABRA]` | `.anagrama` |
| `.batalla` | — | USER | 2 s | solo grupos, requiere registro | Todos contra todos por rondas: elige atacar a alguien o defender. Gana el último en pie (o quien tenga más vida tras 8 rondas). | `.batalla [subcomando]` | `.batalla` |
| `.coinflip` | `.moneda` `.cf` | USER | 3 s | grupo y privado, requiere registro | Lanza una moneda: elige cara o cruz. Apuesta opcional en monedas virtuales (gana el doble si aciertas). | `.coinflip cara\|cruz [apuesta]` | `.coinflip cara 10` |
| `.dados` | `.dice` | USER | 3 s | grupo y privado, requiere registro | Lanzas dos dados contra el bot: gana la suma más alta. Apuesta opcional en monedas virtuales. | `.dados [apuesta]` | `.dados 10` |
| `.duelo` | `.duel` | USER | 2 s | solo grupos, requiere registro | Duelo por turnos 1 contra 1 (atacar, defender, curar) con apuesta opcional: desafía mencionando a alguien y esa persona acepta. | `.duelo @usuario [apuesta]` | `.duelo @usuario 20` |
| `.eliminacion` | — | USER | 2 s | solo grupos, requiere registro | Cada ronda hay una cuenta rápida: quien responde mal o no responde queda eliminado. Si todos fallan, nadie cae. | `.eliminacion [RESPUESTA]` | `.eliminacion` |
| `.juegos` | `.games` | USER | 3 s | grupo y privado | Catálogo de juegos interactivos, estado del juego del chat, tus estadísticas y cancelación por administradores. | `.juegos [subcomando]` | `.juegos lista` |
| `.memoria` | — | USER | 2 s | solo grupos, requiere registro | Memoria inversa: el bot muestra una secuencia de dígitos y gana quien la escriba AL REVÉS (2 intentos por persona). | `.memoria [SECUENCIA_AL_REVES]` | `.memoria` |
| `.ppt` | `.piedrapapeltijera` | USER | 3 s | grupo y privado, requiere registro | Piedra, papel o tijera contra el bot, con apuesta opcional en monedas virtuales. | `.ppt piedra\|papel\|tijera [apuesta]` | `.ppt piedra 10` |
| `.quizff` | `.ffquiz` | USER | 2 s | solo grupos, requiere registro | Pregunta de Free Fire con 4 opciones: gana la primera persona que acierte. El banco es corto y solo tiene hechos comprobables. | `.quizff [A\|B\|C\|D]` | `.quizff` |
| `.reaccion` | `.reflejos` | USER | 2 s | solo grupos, requiere registro | Prueba de reflejos: espera la señal "YA" y escribe .ya primero. Escribir antes de la señal te descalifica. | `.reaccion` | `.reaccion` |
| `.supervivencia` | — | USER | 2 s | solo grupos, requiere registro | Cada ronda hay 3 puertas y solo una es segura: elige con A, B o C. Quien elige mal queda eliminado. Si todos fallan, nadie cae. | `.supervivencia [A\|B\|C]` | `.supervivencia` |
| `.trivia` | `.pregunta` | USER | 2 s | solo grupos, requiere registro | Pregunta de cultura general con 4 opciones: gana la primera persona que acierte (un intento por persona). | `.trivia [A\|B\|C\|D]` | `.trivia` |
| `.ya` | — | USER | 2 s | solo grupos, requiere registro | Responde a la señal de la prueba de reacción (reaccion). El primero después de la señal gana. | `.ya (tras la señal)` | `.ya !` |

### Subcomandos de `.batalla`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.batalla unirse` | `join` | USER + registro | — | Te unes a la sala de Batalla (máx. 8 jugadores). | `.batalla unirse` |
| `.batalla salir` | `leave` | USER + registro | — | Sales de la sala de Batalla antes de que empiece (si eres el anfitrión se cancela). | `.batalla salir` |
| `.batalla iniciar` | `start` | USER + registro | — | El anfitrión inicia Batalla (mínimo 2 jugadores). | `.batalla iniciar` |
| `.batalla estado` | `status` | USER + registro | — | Muestra el estado actual de Batalla. | `.batalla estado` |
| `.batalla atacar` | `attack` | USER + registro | — | En tu ronda, atacas a otro jugador en pie (mencionándolo): 25 de daño, 10 si se defiende. | `.batalla atacar @usuario` |
| `.batalla defender` | `defend` | USER + registro | — | En tu ronda, te defiendes: los golpes que recibas hacen solo 10 de daño. | `.batalla defender` |

### Subcomandos de `.duelo`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.duelo aceptar` | `accept` | USER + registro | — | Aceptas el desafío de duelo que te hicieron. | `.duelo aceptar` |
| `.duelo rechazar` | `reject` | USER + registro | — | Rechazas el desafío de duelo (se devuelve la apuesta al retador). | `.duelo rechazar` |
| `.duelo atacar` | `attack` | USER + registro | — | En tu turno, golpeas a tu rival (15-25 de daño; se reduce a la mitad si se defendía). | `.duelo atacar` |
| `.duelo defender` | `defend` | USER + registro | — | En tu turno, reduces a la mitad el próximo golpe que recibas. | `.duelo defender` |
| `.duelo curar` | `heal` | USER + registro | — | En tu turno, recuperas 10-20 de vida (máximo 3 veces por duelo). | `.duelo curar` |
| `.duelo rendirse` | `surrender` | USER + registro | — | Abandonas el duelo y tu rival gana. | `.duelo rendirse` |
| `.duelo estado` | `status` | USER + registro | — | Muestra el estado del duelo en curso. | `.duelo estado` |

### Subcomandos de `.eliminacion`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.eliminacion unirse` | `join` | USER + registro | — | Te unes a la sala de Eliminación (máx. 20 jugadores). | `.eliminacion unirse` |
| `.eliminacion salir` | `leave` | USER + registro | — | Sales de la sala de Eliminación antes de que empiece (si eres el anfitrión se cancela). | `.eliminacion salir` |
| `.eliminacion iniciar` | `start` | USER + registro | — | El anfitrión inicia Eliminación (mínimo 2 jugadores). | `.eliminacion iniciar` |
| `.eliminacion estado` | `status` | USER + registro | — | Muestra el estado actual de Eliminación. | `.eliminacion estado` |

### Subcomandos de `.juegos`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.juegos lista` | `list` | USER | — | Lista los juegos disponibles y cómo se juegan. | `.juegos lista` |
| `.juegos estado` | `status` | USER | — | Muestra si hay un juego en curso en este chat. | `.juegos estado` |
| `.juegos stats` | `estadisticas` | USER | — | Estadísticas de juegos tuyas o de otra persona (mencionándola). | `.juegos stats [@usuario]` |
| `.juegos cancelar` | `cancel` | ADMIN | — | Un administrador cancela el juego en curso del chat y se devuelven todas las apuestas. | `.juegos cancelar` |

### Subcomandos de `.quizff`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.quizff agregar` | `add` | SUPERADMIN + registro | — | Un SUPERADMIN añade una pregunta al banco: pregunta \| correcta \| incorrecta1 \| incorrecta2 \| incorrecta3. | `.quizff agregar PREGUNTA \| CORRECTA \| MALA1 \| MALA2 \| MALA3` |

### Subcomandos de `.supervivencia`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.supervivencia unirse` | `join` | USER + registro | — | Te unes a la sala de Supervivencia (máx. 20 jugadores). | `.supervivencia unirse` |
| `.supervivencia salir` | `leave` | USER + registro | — | Sales de la sala de Supervivencia antes de que empiece (si eres el anfitrión se cancela). | `.supervivencia salir` |
| `.supervivencia iniciar` | `start` | USER + registro | — | El anfitrión inicia Supervivencia (mínimo 2 jugadores). | `.supervivencia iniciar` |
| `.supervivencia estado` | `status` | USER + registro | — | Muestra el estado actual de Supervivencia. | `.supervivencia estado` |

## economia

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.balance` | `.monedas` `.saldo` | USER | 3 s | grupo y privado, requiere registro | Muestra tus monedas virtuales (no tienen valor real). | `.balance` | `.balance` |

## social

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.amigos` | `.friends` `.amigo` | USER | 3 s | grupo y privado | Tu lista de amigos (o la de otra persona) y gestión de amistades: agregar, aceptar, rechazar, eliminar y ver solicitudes (máximo 50). | `.amigos [@usuario]` | `.amigos` |
| `.estadisticas` | `.stats` `.mystats` | USER | 5 s | grupo y privado | Estadísticas generales de un jugador: nivel, partidas, ELO, juegos, torneos, equipos, amigos y logros. | `.estadisticas [@usuario]` | `.estadisticas` |
| `.insignias` | `.badges` | USER | 5 s | grupo y privado | Insignias actuales según tu estado real: cuenta verificada, capitán, veterano, racha, campeón y amistades. | `.insignias [@usuario]` | `.insignias` |
| `.logros` | `.achievements` | USER | 5 s | grupo y privado | Logros desbloqueados y pendientes (con progreso) de ti o de otra persona. Se calculan con tus datos reales. | `.logros [@usuario]` | `.logros` |
| `.medallas` | `.medals` | USER | 5 s | grupo y privado | Medallas competitivas: torneos ganados, subcampeonatos y podios de temporada (de ti o de otra persona). | `.medallas [@usuario]` | `.medallas` |
| `.titulos` | `.titles` `.titulo` | USER | 5 s | grupo y privado | Títulos que has desbloqueado con tus logros y cuál llevas equipado. Equípalos con "titulos equipar NOMBRE". | `.titulos [@usuario]` | `.titulos` |

### Subcomandos de `.amigos`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.amigos agregar` | `add` `solicitar` | USER + registro | — | Envía una solicitud de amistad. Si esa persona ya te la había enviado, os hacéis amigos al instante. | `.amigos agregar @usuario` |
| `.amigos aceptar` | `accept` | USER + registro | — | Acepta la solicitud de amistad de una persona. | `.amigos aceptar @usuario` |
| `.amigos rechazar` | `reject` | USER + registro | — | Rechaza la solicitud de amistad de una persona. | `.amigos rechazar @usuario` |
| `.amigos eliminar` | `quitar` `remove` | USER + registro | — | Elimina a una persona de tu lista de amigos (también desaparece de la suya). | `.amigos eliminar @usuario` |
| `.amigos solicitudes` | `pendientes` `requests` | USER + registro | — | Muestra las solicitudes de amistad que tienes pendientes. | `.amigos solicitudes` |

### Subcomandos de `.titulos`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.titulos equipar` | `usar` `equip` | USER + registro | — | Equipa uno de tus títulos desbloqueados (se muestra en tu perfil). | `.titulos equipar NOMBRE` |
| `.titulos quitar` | `unequip` | USER + registro | — | Quita el título que llevas equipado. | `.titulos quitar` |

## ranking

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.comparar` | `.compare` `.versus` | USER | 4 s | grupo y privado | Compara jugadores, equipos o perfiles con sus datos reales de ELO, partidas y logros. | `.comparar jugador\|equipo\|perfil ...` | `.comparar equipo EQ-0001 EQ-0002` |
| `.elo` | `.rating` | USER | 3 s | grupo y privado | Tu ELO competitivo (o el de otra persona mencionada): puntuación, pico, récord, posición y temporada. | `.elo [@usuario]` | `.elo` |
| `.ranking` | `.top` `.tops` | USER | 4 s | grupo y privado | Clasificaciones: ELO, victorias, XP, niveles, monedas, juegos, equipos y clanes. | `.ranking [clasificación]` | `.ranking elo` |
| `.rival` | `.rivales` | USER | 4 s | grupo y privado | Tus rivales según partidas reales: el equipo al que más te has enfrentado, tu verdugo y tu víctima favorita. | `.rival [@usuario]` | `.rival` |
| `.temporada` | `.season` | USER | 4 s | grupo y privado | Temporada competitiva actual (ELO), temporadas pasadas y cierre de temporada (SUPERADMIN). | `.temporada` | `.temporada` |

### Subcomandos de `.comparar`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.comparar jugador` | `jugadores` `player` | USER | — | Compara el ELO y las estadísticas de dos jugadores (@a y @b; con uno solo te compara contigo). | `.comparar jugador @a [@b]` |
| `.comparar perfil` | `perfiles` `profile` | USER | — | Compara los perfiles de dos jugadores: título, logros, medallas, insignias, amigos y estadísticas generales. | `.comparar perfil @a [@b]` |
| `.comparar equipo` | `equipos` `team` | USER | — | Compara dos equipos (ELO, récord y enfrentamientos directos). Con uno solo lo compara con el tuyo. | `.comparar equipo ID1 [ID2]` |

### Subcomandos de `.elo`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.elo historial` | `history` | USER | — | Últimos cambios de ELO de un jugador (resultado, rival, variación y ELO resultante). | `.elo historial [@usuario]` |

### Subcomandos de `.ranking`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.ranking elo` | `jugadores` | USER | — | Top de jugadores por ELO (solo jugadores registrados con partidas puntuables). | `.ranking elo` |
| `.ranking victorias` | `wins` | USER | — | Top de jugadores por victorias en partidas de equipo. | `.ranking victorias` |
| `.ranking xp` | — | USER | — | Top de jugadores por experiencia (XP). | `.ranking xp` |
| `.ranking niveles` | `nivel` `levels` | USER | — | Top de jugadores por nivel (desempata por XP). | `.ranking niveles` |
| `.ranking monedas` | `coins` | USER | — | Top de jugadores por monedas virtuales. | `.ranking monedas` |
| `.ranking juegos` | `games` | USER | — | Top de ganadores de juegos interactivos; con un juego concreto, solo de ese juego. | `.ranking juegos [juego]` |
| `.ranking equipos` | `teams` | USER | — | Top de equipos por ELO; opcionalmente de una modalidad (2v2, 4v4 o 6v6). | `.ranking equipos [modo]` |
| `.ranking clanes` | `clans` | USER | — | Top de clanes por ELO medio de sus equipos con partidas jugadas. | `.ranking clanes` |

### Subcomandos de `.temporada`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.temporada historial` | `pasadas` `history` | USER | — | Temporadas cerradas con su podio de jugadores y equipos. | `.temporada historial` |
| `.temporada cerrar` | `close` | SUPERADMIN | — | Cierra la temporada actual: guarda el podio, reparte monedas virtuales a los primeros, aplica el reinicio suave de ELO e inicia la siguiente. | `.temporada cerrar` |

## tools

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.8ball` | `.bola8` `.bola` | USER | 3 s | grupo y privado | La bola mágica responde a una pregunta de sí/no (solo diversión). | `.8ball <pregunta>` | `.8ball ¿ganaremos hoy?` |
| `.apistatus` | `.estadoapis` | USER | 5 s | grupo y privado | Estado de los servicios externos (Free Fire, clanes y medios). Los usuarios ven un resumen; ADMIN/OWNER ven cada proveedor (nunca claves ni URLs). "apistatus probar" (ADMIN) verifica los proveedores ahora. | `.apistatus [probar]` | `.apistatus` |
| `.base64` | `.b64` | USER | 2 s | grupo y privado | Codifica o decodifica Base64: "base64 codificar hola" / "base64 decodificar aG9sYQ==". Sin modo, codifica. | `.base64 [codificar\|decodificar] <texto>` | `.base64 hola` |
| `.calculadora` | `.calc` `.calcular` | USER | 2 s | grupo y privado | Calculadora segura (sin ejecutar código): + − × ÷ % ^ paréntesis, pi, e y funciones sqrt abs round floor ceil sin cos tan ln log exp. | `.calculadora <operación>` | `.calc (2+3)*4^2` |
| `.chiste` | `.joke` | USER | 3 s | grupo y privado | Un chiste corto y sano (texto original del bot). | `.chiste` | `.chiste` |
| `.color` | `.colour` | USER | 2 s | grupo y privado | Convierte un color entre HEX, RGB y HSL. Acepta #ff8800 o "255 136 0". | `.color <#hex \| r g b>` | `.color #ff8800` |
| `.contar` | `.count` | USER | 2 s | grupo y privado | Cuenta caracteres, letras, dígitos, palabras y líneas de un texto. | `.contar <texto>` | `.contar hola mundo` |
| `.convertir` | `.convert` `.conv` | USER | 2 s | grupo y privado | Convierte unidades de longitud, masa, volumen, tiempo, velocidad, datos y temperatura. No convierte monedas (no hay tasas en vivo). | `.convertir <valor> <unidad origen> <unidad destino>` | `.convertir 10 km mi` |
| `.dado` | — | USER | 2 s | grupo y privado | Lanza dados: "dado" (1d6), "dado 20" (1d20) o "dado 3d8" (hasta 10 dados de hasta 1000 caras). | `.dado [caras \| NdC]` | `.dado 2d6` |
| `.decode64` | — | USER | 2 s | grupo y privado | Decodifica un texto Base64 (solo si el resultado es texto UTF-8 válido). | `.decode64 <base64>` | `.decode64 aG9sYQ==` |
| `.device` | `.dispositivo` | USER | 5 s | grupo y privado | Estima el tipo de dispositivo (Android, iOS, Web/Escritorio, bot) a partir del ID del mensaje. Responde a un mensaje para analizar el suyo. Es una heurística, no un dato oficial. | `.device (respondiendo a un mensaje)` | `.device` |
| `.encode64` | — | USER | 2 s | grupo y privado | Codifica un texto en Base64. | `.encode64 <texto>` | `.encode64 hola` |
| `.fecha` | `.date` | USER | 2 s | grupo y privado | Fecha actual en la zona horaria del bot (o en otra zona IANA, por ejemplo America/Bogota). | `.fecha [zona]` | `.fecha` |
| `.frase` | `.quote` | USER | 3 s | grupo y privado | Una frase motivadora de gaming (texto original del bot). | `.frase` | `.frase` |
| `.hash` | — | USER | 2 s | grupo y privado | Calcula el hash de un texto con md5, sha1, sha256 o sha512 (por defecto sha256). | `.hash [algoritmo] <texto>` | `.hash sha256 hola` |
| `.hex` | — | USER | 2 s | grupo y privado | Número → hexadecimal, 0x… → decimal, o texto → bytes UTF-8 en hexadecimal. | `.hex <número \| 0x… \| texto>` | `.hex 255` |
| `.hora` | `.time` | USER | 2 s | grupo y privado | Hora actual en la zona horaria del bot (o en otra zona IANA). | `.hora [zona]` | `.hora Europe/Madrid` |
| `.info` | `.whoami` `.chatinfo` | USER | 5 s | grupo y privado | Información real de este chat y de tu usuario (rol en el bot, registro, tipo de chat y datos del grupo). | `.info` | `.info` |
| `.json` | `.jsonformat` | USER | 3 s | grupo y privado | Valida y da formato a un JSON. Si es inválido, indica el error. | `.json <JSON>` | `.json {"a":1}` |
| `.mayus` | `.upper` | USER | 2 s | grupo y privado | Convierte un texto a MAYÚSCULAS. | `.mayus <texto>` | `.mayus hola` |
| `.md5` | — | USER | 2 s | grupo y privado | Hash MD5 de un texto (no es seguro para contraseñas; solo para comprobar integridad). | `.md5 <texto>` | `.md5 hola` |
| `.minus` | `.lower` | USER | 2 s | grupo y privado | Convierte un texto a minúsculas. | `.minus <texto>` | `.minus HOLA` |
| `.ping` | `.p` | USER | 3 s | grupo y privado | Comprueba que el bot responde y estima el retraso entre tu mensaje y su procesamiento. | `.ping` | `.ping` |
| `.qr` | `.codigoqr` | USER | 8 s | grupo y privado | Genera un código QR (imagen) con el texto o enlace indicado (hasta ~200 caracteres). | `.qr <texto o enlace>` | `.qr https://ejemplo.com` |
| `.random` | `.aleatorio` `.rand` | USER | 2 s | grupo y privado | Número aleatorio entre dos valores (por defecto 1 y 100), con aleatoriedad criptográfica. | `.random [mín] [máx]` | `.random 1 10` |
| `.reverse` | `.invertir` | USER | 2 s | grupo y privado | Invierte un texto (de atrás hacia adelante). | `.reverse <texto>` | `.reverse hola` |
| `.sha256` | — | USER | 2 s | grupo y privado | Hash SHA-256 de un texto. | `.sha256 <texto>` | `.sha256 hola` |
| `.suerte` | `.luck` | USER | 3 s | grupo y privado | Tu suerte del día (0-100). Es un juego: se calcula a partir de tu usuario y la fecha, no predice nada real. | `.suerte` | `.suerte` |
| `.texto` | `.estilo` | USER | 2 s | grupo y privado | Transforma un texto: capitalizar, snake, kebab, camel, slug, sinacentos, espaciado, alternado. | `.texto <estilo> <texto>` | `.texto snake Hola Mundo` |
| `.timestamp` | `.epoch` | USER | 2 s | grupo y privado | Sin argumentos: la marca de tiempo Unix actual. Con un número: lo convierte a fecha. Con una fecha ISO (2026-10-05 18:30): lo convierte a Unix. | `.timestamp [número \| fecha]` | `.timestamp 1760000000` |
| `.uuid` | `.guid` | USER | 3 s | grupo y privado | Genera un UUID v4 aleatorio (hasta 5). | `.uuid [cantidad]` | `.uuid` |

## play

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.abrir` | `.open` | USER | 3 s | grupo y privado | Muestra el enlace real del elemento elegido. | `.abrir [N]` | `.abrir` |
| `.buscar` | `.search` | USER | 6 s | grupo y privado | Busca canciones y videos y lista los resultados reales del proveedor. | `.buscar <texto>` | `.buscar nombre de la canción` |
| `.buscarmusica` | `.searchmusic` | USER | 6 s | grupo y privado | Busca solo música (audio). | `.buscarmusica <texto>` | `.buscarmusica nombre de la canción` |
| `.buscarvideo` | `.searchvideo` | USER | 6 s | grupo y privado | Busca solo videos. | `.buscarvideo <texto>` | `.buscarvideo tutorial` |
| `.infoaudio` | — | USER | 8 s | grupo y privado | Muestra los datos del resultado elegido y comprueba si su AUDIO se puede descargar (sin descargarlo). | `.infoaudio [N]` | `.infoaudio 1` |
| `.infovideo` | — | USER | 8 s | grupo y privado | Muestra los datos del resultado elegido y comprueba si su VIDEO se puede descargar (sin descargarlo). | `.infovideo [N]` | `.infovideo 1` |
| `.miniatura` | `.thumbnail` `.thumb` | USER | 8 s | grupo y privado | Envía la miniatura del resultado elegido, solo si el proveedor entregó una. | `.miniatura [N]` | `.miniatura 1` |
| `.play` | `.reproducir` | USER | 8 s | grupo y privado | Busca una canción o video, muestra sus datos reales y ofrece descargar el audio o el video. También acepta un enlace o el número de un resultado anterior. | `.play <búsqueda \| enlace \| N>` | `.play nombre de la canción` |
| `.playaudio` | `.audio` `.mp3` | USER | 15 s | grupo y privado | Descarga y envía el AUDIO del resultado elegido (o de una búsqueda/enlace/número) si el proveedor lo permite. | `.playaudio [búsqueda \| enlace \| N]` | `.playaudio 2` |
| `.playcancelar` | `.playcancel` | USER | 2 s | grupo y privado | Cancela la selección actual de .play (los botones asociados dejan de servir). | `.playcancelar` | `.playcancelar` |
| `.playvideo` | `.video` `.mp4` | USER | 20 s | grupo y privado | Descarga y envía el VIDEO del resultado elegido (o de una búsqueda/enlace/número) si el proveedor lo permite. | `.playvideo [búsqueda \| enlace \| N]` | `.playvideo 1` |

## moderacion

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.admins` | `.administradores` | USER | 10 s | solo grupos | Lista los administradores del grupo según WhatsApp y los menciona. | `.admins` | `.admins` |
| `.antiflood` | — | ADMIN | 3 s | solo grupos | Borra los mensajes de quien escribe demasiado rápido (no administradores) y le pone una advertencia. Requiere que el bot sea administrador. | `.antiflood on\|off [mensajes [segundos]]` | `.antiflood on` |
| `.antilinks` | — | ADMIN | 3 s | solo grupos | Borra los mensajes con enlaces de quien no sea administrador y le pone una advertencia. Requiere que el bot sea administrador. | `.antilinks on\|off` | `.antilinks on` |
| `.antispam` | — | ADMIN | 3 s | solo grupos | Borra los mensajes repetidos de quien no sea administrador y le pone una advertencia. Requiere que el bot sea administrador. | `.antispam on\|off [repeticiones [segundos]]` | `.antispam on` |
| `.goodbye` | — | ADMIN | 3 s | solo grupos | Configura el mensaje de despedida del grupo: actívalo/desactívalo o cambia el texto ({usuario}, {grupo}, {miembros}). | `.goodbye on\|off\|texto MENSAJE\|ver` | `.goodbye texto Bienvenido {usuario} a {grupo}` |
| `.groupinfo` | `.infogrupo` | USER | 10 s | solo grupos | Información real del grupo: nombre, miembros, administradores, si el bot es admin, clan y protecciones activas. | `.groupinfo` | `.groupinfo` |
| `.grupoconfig` | `.gconfig` `.configgrupo` | ADMIN | 3 s | solo grupos | Muestra la configuración de moderación del grupo y permite ajustar límites (maxwarns, warnaccion, flood, spam). | `.grupoconfig [ajuste]` | `.grupoconfig` |
| `.hidetag` | `.avisar` | ADMIN | 30 s | solo grupos | Envía tu mensaje mencionando a todos sin mostrar las etiquetas (todos reciben la notificación). | `.hidetag MENSAJE` | `.hidetag Reunión en 10 minutos` |
| `.modlogs` | `.logsmod` | ADMIN | 5 s | solo grupos | Últimas acciones de moderación registradas en este grupo (advertencias, silencios, cambios de configuración). | `.modlogs [cantidad]` | `.modlogs 10` |
| `.mute` | `.silenciar` | MOD | 3 s | solo grupos | Silencia a una persona: el bot borra sus mensajes durante unos minutos (por defecto 30). Requiere que el bot sea administrador. | `.mute @usuario [minutos] [motivo]` | `.mute @usuario 15 spam` |
| `.permisos` | `.roles` | USER | 5 s | solo grupos | Muestra tu rol (o el de otra persona mencionada) y si el bot es administrador de este grupo. | `.permisos [@usuario]` | `.permisos` |
| `.tagall` | `.todos` | ADMIN | 30 s | solo grupos | Menciona a todos los miembros reales del grupo (según los datos de WhatsApp), con un mensaje opcional. | `.tagall [mensaje]` | `.tagall Hoy hay scrim a las 20:00` |
| `.unmute` | `.desilenciar` | MOD | 3 s | solo grupos | Quita el silencio a una persona del grupo. | `.unmute @usuario` | `.unmute @usuario` |
| `.unwarn` | `.quitarwarn` | MOD | 3 s | solo grupos | Quita la última advertencia de una persona (o una concreta por su ID, por ejemplo W-0007). | `.unwarn @usuario [ID]` | `.unwarn @usuario` |
| `.warn` | `.advertir` | MOD | 3 s | solo grupos | Pone una advertencia a una persona del grupo (mención o respuesta). Al llegar al máximo se aplica la acción configurada. | `.warn @usuario [motivo]` | `.warn @usuario insultos` |
| `.warnlist` | `.listawarns` | MOD | 5 s | solo grupos | Lista las personas con advertencias en este grupo. | `.warnlist` | `.warnlist` |
| `.warns` | `.advertencias` | USER | 4 s | solo grupos | Muestra tus advertencias en este grupo o las de otra persona mencionada. | `.warns [@usuario]` | `.warns` |
| `.welcome` | — | ADMIN | 3 s | solo grupos | Configura el mensaje de bienvenida del grupo: actívalo/desactívalo o cambia el texto ({usuario}, {grupo}, {miembros}). | `.welcome on\|off\|texto MENSAJE\|ver` | `.welcome texto Bienvenido {usuario} a {grupo}` |

### Subcomandos de `.grupoconfig`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.grupoconfig maxwarns` | — | ADMIN | — | Cantidad de advertencias a partir de la cual se aplica la acción configurada (1 a 10). | `.grupoconfig maxwarns N` |
| `.grupoconfig warnaccion` | — | ADMIN | — | Qué pasa al llegar al máximo de advertencias: nada (solo avisa) o kick (expulsa; requiere que el bot sea admin). | `.grupoconfig warnaccion nada\|kick` |
| `.grupoconfig flood` | — | ADMIN | — | Límite del antiflood: MENSAJES (2-30) permitidos en SEGUNDOS (2-60). | `.grupoconfig flood MENSAJES SEGUNDOS` |
| `.grupoconfig spam` | — | ADMIN | — | Límite del antispam: REPETICIONES (2-10) del mismo mensaje en SEGUNDOS (5-300). | `.grupoconfig spam REPETICIONES SEGUNDOS` |

## owner

| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |
|---|---|---|---|---|---|---|---|
| `.addadmin` | — | OWNER | 3 s | grupo y privado | Asigna el rol ADMIN del bot a una persona. | `.addadmin @usuario\|número` | `.addadmin @usuario` |
| `.addmod` | — | OWNER | 3 s | grupo y privado | Asigna el rol MOD del bot a una persona. | `.addmod @usuario\|número` | `.addmod @usuario` |
| `.backup` | `.respaldar` | OWNER | 30 s | grupo y privado | Crea ahora una copia de seguridad de la base de datos. | `.backup` | `.backup` |
| `.backups` | `.listabackups` | OWNER | 5 s | grupo y privado | Lista los backups disponibles (los más recientes primero). | `.backups` | `.backups` |
| `.banuser` | `.banear` | OWNER | 3 s | grupo y privado | Banea a una persona del bot: no podrá usar comandos y el bot ignorará sus mensajes en todos los grupos. | `.banuser @usuario\|número [motivo]` | `.banuser @usuario spam` |
| `.botinfo` | `.infobot` | OWNER | 5 s | grupo y privado | Información del bot: nombre, versión, entorno, prefijo, zona horaria y cantidad de comandos y plugins. | `.botinfo` | `.botinfo` |
| `.botstatus` | `.estadobot` | OWNER | 5 s | grupo y privado | Estado en vivo del bot: conexión de WhatsApp, scheduler, memoria y modo mantenimiento. | `.botstatus` | `.botstatus` |
| `.broadcast` | `.difusion` `.anuncio` | OWNER | 5 s | grupo y privado | Anuncio a todos los grupos donde el bot puede escribir. Primero muestra una vista previa; se envía con "broadcast confirmar" (vence en 2 min). | `.broadcast TEXTO` | `.broadcast Mañana hay mantenimiento a las 20:00` |
| `.dbstats` | `.estadisticasdb` | OWNER | 10 s | grupo y privado | Estadísticas de la base de datos: registros por colección, tamaño del archivo y backups. | `.dbstats` | `.dbstats` |
| `.deladmin` | — | OWNER | 3 s | grupo y privado | Quita el rol ADMIN a una persona (vuelve a USER). Solo si tenía exactamente ese rol. | `.deladmin @usuario\|número` | `.deladmin @usuario` |
| `.delmod` | — | OWNER | 3 s | grupo y privado | Quita el rol MOD a una persona (vuelve a USER). Solo si tenía exactamente ese rol. | `.delmod @usuario\|número` | `.delmod @usuario` |
| `.errors` | `.errores` | OWNER | 5 s | grupo y privado | Últimos errores registrados por el bot desde que arrancó (sin trazas ni datos sensibles). | `.errors [cantidad]` | `.errors 10` |
| `.grupoinfo` | `.infogrupobot` | OWNER | 5 s | grupo y privado | Detalle de un grupo de la lista de *grupos* (por número) o por su ID: miembros, admins, permisos del bot, clan y protecciones. | `.grupoinfo NÚMERO\|ID` | `.grupoinfo 1` |
| `.grupos` | `.listagrupos` | OWNER | 10 s | grupo y privado | Lista los grupos en los que el bot está presente ahora (consultados a WhatsApp), con miembros y si puede escribir. | `.grupos` | `.grupos` |
| `.logs` | `.auditoria` | OWNER | 5 s | grupo y privado | Últimos registros de auditoría (acciones administrativas). Se puede filtrar por ámbito: moderacion, admin, equipo, torneo, elo… | `.logs [cantidad] [ámbito]` | `.logs 10 admin` |
| `.mantenimiento` | `.maintenance` | OWNER | 3 s | grupo y privado | Activa o desactiva el modo mantenimiento: mientras está activo, solo el OWNER puede usar comandos. | `.mantenimiento on\|off [motivo]` | `.mantenimiento on actualizando` |
| `.plugininfo` | `.infoplugin` | OWNER | 5 s | grupo y privado | Detalle de un plugin: sus comandos y permisos requeridos. | `.plugininfo NOMBRE` | `.plugininfo equipos` |
| `.plugins` | `.listaplugins` | OWNER | 5 s | grupo y privado | Lista los plugins cargados y cuántos comandos aporta cada uno. | `.plugins` | `.plugins` |
| `.reload` | `.recargar` | OWNER | 15 s | grupo y privado | Vacía las cachés (grupos y APIs), vuelve a sincronizar los trabajos programados con la base de datos y guarda los datos. No recarga código ni .env (para eso, reinicia el bot). | `.reload` | `.reload` |
| `.restore` | `.restaurar` | OWNER | 10 s | grupo y privado | Restaura un backup (por número de la lista de *backups* o por nombre). Hace antes un backup "prerestore" y exige escribir "confirmar". | `.restore NÚMERO\|NOMBRE confirmar` | `.restore 1 confirmar` |
| `.statsbot` | `.estadisticasbot` | OWNER | 10 s | grupo y privado | Estadísticas de uso reales del bot: usuarios, grupos, equipos, partidas, torneos, scrims, juegos y actividad acumulada. | `.statsbot` | `.statsbot` |
| `.unbanuser` | `.desbanear` | OWNER | 3 s | grupo y privado | Quita el baneo del bot a una persona. | `.unbanuser @usuario\|número` | `.unbanuser @usuario` |
| `.uptime` | `.tiempoactivo` | OWNER | 3 s | grupo y privado | Tiempo que lleva el bot en marcha (proceso) y desde cuándo está conectado a WhatsApp. | `.uptime` | `.uptime` |

### Subcomandos de `.broadcast`

| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |
|---|---|---|---|---|---|
| `.broadcast confirmar` | `confirm` `enviar` | OWNER | — | Envía el anuncio preparado a todos los grupos donde el bot puede escribir (una sola vez). | `.broadcast confirmar` |
| `.broadcast cancelar` | `cancel` | OWNER | — | Descarta el anuncio preparado sin enviarlo. | `.broadcast cancelar` |

