# APIs externas de BW BOT PREMIUM

> **Estado honesto de verificación (última comprobación: 2026-10-04):** desde el entorno de desarrollo **no hay salida
> a Internet hacia estos servicios** (el proxy bloquea los hosts: `curl` devuelve `000`; `WebFetch` a la instancia pública
> de free-ff-api devolvió `404`). Por eso **ningún proveedor real se probó en vivo**. Los adaptadores se construyeron a partir
> de la documentación pública de cada servicio y se probaron **solo contra servidores HTTP locales que simulan el formato
> documentado** (`tests/multiapi.test.js`). Antes de depender de uno, ejecuta `npm run ff-probe -- UID REGION --raw`
> (o `clan-probe`) y `.apistatus probar` desde un entorno con Internet, y anota el resultado abajo.

## 1. FUNCIONA Y FUE PROBADO (en vivo)

**Ninguno.** No se pudo verificar ningún servicio externo real desde el entorno de desarrollo.

Lo que sí está probado automáticamente (con servidores locales, sin Internet):

| Qué | Cómo | Dónde |
|---|---|---|
| Fallback API1 → API2 → API3 → "ningún proveedor disponible" | servidores HTTP locales reales | `tests/multiapi.test.js` |
| Timeout, HTTP 429 (con `Retry-After`), 500, 502, 503, 504, JSON inválido, respuesta incompleta | idem | idem |
| Jugador/clan no encontrado ≠ API caída; clave inválida (HTTP 401/403 y 200 con mensaje); región no soportada; no configurado | idem | idem |
| Reintentos acotados con backoff, cooldown, recuperación automática, health check | idem | idem |
| Caché (no oculta errores permanentes), límite propio por proveedor, prioridades, activar/desactivar | idem | idem |
| Fusión de campos entre proveedores con procedencia (sin pisar ni inventar) | idem | idem |
| Adaptadores `hlgaming`, `ffcommunity`, `jinix`, `gameskinbo`: construcción de la petición (parámetros, cabeceras, clave fuera de la URL) y normalización de la respuesta documentada | respuestas simuladas | idem |
| `.play`: búsqueda, disponibilidad, descarga con validación MIME/extensión/firma/tamaño, SSRF, caché, cola, limpieza | proveedor HTTP local | `tests/media.test.js` |
| Generador de QR propio | decodificado con OpenCV (`QRCodeDetector`) durante el desarrollo | `tests/tools.test.js` (regresión estructural) |

## 2. DOCUMENTADO PERO NO SE PUDO PROBAR (proveedores de Free Fire)

Todos son terceros no oficiales; Garena no publica una API oficial de consulta de jugadores. Pueden cambiar, limitar o
desaparecer. Por eso el bot **no depende de ninguno**: se configuran uno o varios y el sistema salta de uno a otro.

Leyenda de columnas: *Función*: J = jugador, C = clan/guild.

### 2.1 `hlgaming` — HL Gaming Official
| Campo | Valor |
|---|---|
| Función | J (`sectionName=AccountInfo`) y C (`sectionName=GuildInfo`) |
| URL base | `https://proapis.hlgamingofficial.com/main/games/freefire/account/api` |
| Endpoints | un solo endpoint; `sectionName` elige la sección (AccountInfo, AccountProfileInfo, GuildInfo, captainBasicInfo, creditScoreInfo, petInfo, socialinfo, AllData, BanCheck) |
| Parámetros | `PlayerUid`, `region`, `useruid`, `api` |
| Regiones | ind, br, sg, ru, id, tw, us, vn, th, me, pk, cis, bd |
| Autenticación / clave | **Requerida.** Configurar `FF_PROVIDER_n_KEY=USERUID:APIKEY` (el adaptador separa `useruid` y `api`) |
| Límites | plan gratuito con límite diario (la respuesta trae `usedToday/dailyLimit/remainingToday`); otros planes de pago |
| Campos usados | AccountName, AccountLevel, AccountEXP, AccountLikes, AccountRegion, BrRankPoint, CsRankPoint; guild: GuildName, GuildLevel, GuildMember, GuildCapacity |
| Formato | JSON; errores en el cuerpo ("Auth Failed!…", "Invalid API key.") → `API_AUTH_ERROR` |
| Adaptador | `src/providers/registry.js` → preset `hlgaming` |
| Verificación | **DOCUMENTADO PERO NO SE PUDO PROBAR** (2026-10-04, sin red) |
| Notas | la clave nunca viaja en el código ni en logs; la URL con la clave nunca se muestra |

### 2.2 `ffcommunity` — Free Fire Community API Hub
| Campo | Valor |
|---|---|
| Función | J (la ficha incluye `clanBasicInfo` con clan del jugador). No tiene endpoint de clan propio |
| URL base | `https://developers.freefirecommunity.com/api/v1` |
| Endpoint | `GET /info?region=<r>&uid=<uid>` |
| Regiones | sg, ind, br y "otras" (sin lista cerrada documentada → el bot no restringe) |
| Autenticación / clave | **Requerida:** cabecera `x-api-key` (el adaptador **no** la pone en la URL) |
| Límites | cortafuegos de borde con HTTP 429 (reintentar tras ~60 s); exige `User-Agent` de ≥10 caracteres sin nombres de librerías/bots (el adaptador usa `FFInfoClient/1.0 (+whatsapp-community)`) |
| Campos | basicInfo (accountId, nickname, level, rank, region, seasonId), captainBasicInfo, clanBasicInfo (clanId, clanName, clanLevel, memberNum, capacity), petInfo, profileInfo, socialInfo, creditScoreInfo |
| Verificación | **DOCUMENTADO PERO NO SE PUDO PROBAR** |

### 2.3 `jinix` — free-ff-api (jinix6), instancia pública
| Campo | Valor |
|---|---|
| Función | J (`/api/v1/account`) y C (`/api/v1/guildInfo`) |
| URL base | `https://free-ff-api-src-5plp.onrender.com` (alojada en Render: puede estar "dormida"/inestable; **puedes autoalojar el proyecto** y poner tu URL en `FF_PROVIDER_n_URL`) |
| Parámetros | `region` (en mayúsculas), `uid` / `guildID` |
| Regiones | IND, BR, SG, RU, ID, TW, US, VN, TH, ME, PK, CIS, BD |
| Autenticación / clave | ninguna |
| Límites | sin documentar; el proyecto cachea 5 min |
| Campos | accountId, nickname, level, rank, rankingPoints, lastLoginAt, badges; guild: clanId, clanName, clanLevel, memberNum, capacity, createAt, captainId |
| Verificación | **DOCUMENTADO PERO NO SE PUDO PROBAR.** Intentos: `curl` sin conexión; `WebFetch` a `/` y a `/api/v1/account?region=sg&uid=…` → 404 (inconcluso) |

### 2.4 `gameskinbo` — GameSkinBo FF Info
| Campo | Valor |
|---|---|
| Función | J |
| URL base | `https://api.gameskinbo.com` |
| Endpoint | `GET /ff-info/get?uid=<uid>&region=<r opcional>` |
| Regiones | BD, IND, BR, US, SAC, NA, TH, ID, SG, PK |
| Autenticación / clave | **Requerida:** cabecera `x-api-key` |
| Límites | plan gratuito 5 solicitudes/min (básico 30, pro sin límite). Usa `FF_PROVIDER_n_RATE_LIMIT=5` para que el bot no la sature |
| Campos | AccountInfo (AccountName, AccountLevel, AccountEXP, AccountRegion, AccountLikes…), AccountProfileInfo (BrRankPoint, CsRankPoint…) |
| Verificación | **DOCUMENTADO PERO NO SE PUDO PROBAR** |

### 2.5 Evaluados y NO integrados
| Servicio | Motivo |
|---|---|
| siambhau/FreeFireApi (`http://siambhau69.eu.cc`) | HTTP sin cifrar; sus endpoints útiles piden credenciales de cuenta (JWT/contraseña/access token): **fuera de alcance** (flujos de credenciales de cuenta). Un endpoint de info gratuito existe, pero con clave entregada por Telegram y sin HTTPS |
| ashqking/Free-Fire-API, HubsGGx/FreeFire-Apis, PRINCE-lki/Free-Fire-free-APIS, Errorexe849/free-fire-info-api-ob55, LokayaFx/FreeFire-Idinfo, haroonbrokha1/… | no evaluados a fondo (proyectos de repositorio, muchos envuelven a HL Gaming); se pueden usar como proveedor `generic` con una plantilla de URL si los alojas |

### 2.6 Cualquier otra API (proveedor `generic`)
Plantilla de URL con marcadores `{uid}` (clanes: `{id}`), `{region}`, `{key}`; `FF_PROVIDER_n_AUTH_HEADER=x-api-key` envía la clave
en cabecera. El normalizador acepta alias frecuentes (`nickname|name|playerName|AccountName`, `level|AccountLevel`, `exp|AccountEXP`,
`likes|liked|AccountLikes`, `rank`, `BrRankPoint`…). **Lo que el proveedor no entrega queda ausente: nunca se inventa.**

## 3. Medios (`.play` y relacionados)
No se incluye ningún proveedor de descarga de medios ni se recomienda uno: cada operador configura el suyo y es responsable de
que su uso respete los términos y la legalidad del contenido. El bot **no elude DRM, muros de pago ni restricciones**: si el proveedor
no permite la descarga, lo dice.

| Elemento | Detalle |
|---|---|
| Configuración | `MEDIA_PROVIDER_n_URL/KEY/ENABLED/PRIORITY/TIMEOUT/NAME` + `MEDIA_PROVIDERS=provider1,provider2`; compatible con `PLAY_API_URLS`, `PLAY_SEARCH_URLS`, `PLAY_DOWNLOAD_URLS` |
| Marcadores | `{query}` (búsqueda), `{type}` (audio/video/all), `{limit}`, `{url}`/`{id}` (descarga), `{key}` |
| Respuesta de búsqueda | JSON con una lista (`results`, `items`, `data`, `videos`, `tracks`…) de objetos con `title` y `url` o `id`; opcionales `author|channel|uploader`, `duration`, `views`, `published|date`, `thumbnail` |
| Respuesta de descarga | JSON con una URL de archivo (`download`, `url`, `audio`, `video`, `file`…) o el archivo directamente (`audio/*`, `video/*`) |
| Validaciones | MIME + extensión + **firma real del archivo** + tamaño (`MAX_PLAY_FILE_SIZE`), solo URLs públicas (anti-SSRF, redirecciones comprobadas) |
| Verificación | **DOCUMENTADO PERO NO SE PUDO PROBAR** con un proveedor real; probado con proveedor local simulado |

## 4. Cómo se comporta el fallback
1. `.ff UID` → `FreeFireService` → **ProviderManager** → ProviderRouter (prioridad, región soportada, salud) → proveedor → **normalizador** → respuesta.
2. Fallo = timeout, HTTP 5xx/429, conexión rechazada, DNS, JSON inválido, respuesta incompleta o sin campos obligatorios → siguiente proveedor.
3. Reintentos acotados (solo timeouts/red/5xx; `FF_PROVIDER_n_RETRIES`, backoff exponencial); 429 → proveedor limitado temporalmente (respeta `Retry-After`, máx. 5 min); 401/403 o "Invalid API key" → `API_AUTH_ERROR` con cooldown de 10 min.
4. Tres fallos seguidos → cooldown de 60 s; pasado el cooldown el proveedor vuelve a la rotación y un éxito (o `apistatus probar`) lo deja sano.
5. Si ningún proveedor soporta la región pedida → `REGION_NOT_SUPPORTED`. Sin región, se prueban las configuradas (`FF_REGIONS`) en orden.
6. **Fusión por campos:** si el primero no entrega `nickname/level/exp/likes/rank`, se consultan hasta `FF_MERGE_MAX_EXTRA` proveedores más solo para completar los campos ausentes; se guarda de qué proveedor salió cada campo (interno).
7. Códigos: `PLAYER_NOT_FOUND`, `CLAN_NOT_FOUND`, `API_DOWN`, `API_TIMEOUT`, `API_RATE_LIMIT`, `API_NOT_CONFIGURED`, `API_INVALID_RESPONSE`, `API_AUTH_ERROR`, `REGION_NOT_SUPPORTED`. "No encontrado" **nunca** se confunde con "API caída" y los fallos **nunca** se cachean.
8. `.apistatus`: los usuarios ven un resumen por servicio; ADMIN/OWNER ven cada proveedor (estado, prioridad, latencia, aciertos/errores, último error, cooldown, regiones, si requiere clave). `.apistatus probar` (ADMIN) lanza un health check si `FF_HEALTH_UID`/`CLAN_HEALTH_ID`/`MEDIA_HEALTH_QUERY` están definidos.

## 5. Ejemplo de configuración (sin claves reales)
```env
FREEFIRE_PROVIDERS=ffcommunity,hlgaming,jinix
FF_PROVIDER_FFCOMMUNITY_KEY=tu-clave
FF_PROVIDER_HLGAMING_KEY=tu_useruid:tu_api_key
FF_PROVIDER_HLGAMING_RATE_LIMIT=10
FF_REGIONS=br,us,sg,ind
FF_HEALTH_UID=un-uid-publico-conocido

CLAN_PROVIDERS=hlgaming,jinix
CLAN_PROVIDER_HLGAMING_KEY=tu_useruid:tu_api_key

MEDIA_PROVIDER_1_URL=https://tu-proveedor.example/search?q={query}&type={type}
MEDIA_PROVIDER_2_URL=https://tu-proveedor.example/dl?url={url}&type={type}&key={key}
MEDIA_PROVIDER_2_KEY=tu-clave
```
Las claves viven solo en `.env` (excluido de git y del ZIP). Los mensajes, logs y `.apistatus` nunca muestran claves ni URLs completas.

## 6. Registro de verificaciones
| Fecha | Proveedor | Resultado |
|---|---|---|
| 2026-10-04 | hlgaming, ffcommunity, jinix, gameskinbo | sin conexión desde el entorno de desarrollo (HTTP `000`); no verificado |
| 2026-10-04 | jinix (WebFetch a `/` y a `/api/v1/account`) | HTTP 404 (inconcluso: instancia dormida o cambiada) |
| _(pendiente)_ | todos | ejecutar `npm run ff-probe` / `clan-probe` / `.apistatus probar` con Internet y anotar aquí |
