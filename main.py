# -*- coding: utf-8 -*-
# ╔══════════════════════════════════════════════════════════════════════╗
# ║                                                                      ║
# ║   ██████╗  █████╗ ███████╗██╗███╗   ██╗                              ║
# ║   ██╔══██╗██╔══██╗██╔════╝██║████╗  ██║                              ║
# ║   ██████╔╝███████║█████╗  ██║██╔██╗ ██║                              ║
# ║   ██╔══██╗██╔══██║██╔══╝  ██║██║╚██╗██║                              ║
# ║   ██║  ██║██║  ██║██║     ██║██║ ╚████║                              ║
# ║   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝                              ║
# ║                                                                      ║
# ║          ✦  R A F I N   T x T  ✦   P R E M I U M  ✦                  ║
# ║                                                                      ║
# ╚══════════════════════════════════════════════════════════════════════╝
#
#  ╭──────────────────────────────────────────────────────────────────╮
#  │  ◆ PROYECTO  ›  Escuadra de 4 bots para Free Fire                 │
#  │  ◆ ARCHIVO   ›  main.py                                          │
#  │  ◆ BASADO EN ›  RAFIN TxT                                        │
#  │  ◆ CORRE EN  ›  Python 3.10+                                     │
#  ╰──────────────────────────────────────────────────────────────────╯
#
#  © 2026 RAFIN TxT
# ════════════════════════════════════════════════════════════════════════
import sys, os, json, time, uuid, random, asyncio, base64, struct, socket
import itertools, traceback, ssl, hmac, hashlib, string, re, subprocess, math
import httpx
import aiohttp
import aiohttp.web
from datetime import datetime
import types
import escuadra
import sistema
from typing import Dict, List, Optional, Tuple, Any

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

from google_play_scraper import app as play_scraper
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
from protobuf_decoder.protobuf_decoder import Parser
from message_ids import MESSAGE_ID_TO_NAME
import thunderFF_pb2

try:
    import StartMatch_pb2
except Exception:
    StartMatch_pb2 = None

try:
    import reqClan_pb2
    _CLAN_PB_AVAILABLE = True
except Exception:
    _CLAN_PB_AVAILABLE = False

# ==================== AJUSTES ====================
WEB_HOST = os.environ.get("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.environ.get("PORT") or os.environ.get("WEB_PORT") or 25567)
ACCOUNTS_FILE = "accounts.json"
TOKEN_CACHE_FILE = "token_cache.json"
DEVICES_FILE = "devices.json"
TOKEN_CACHE_TTL = 1200
INDEX_HTML_PATH = "panel/index.html"

START_MATCH_INTERVAL = 3.0
NEW_MATCH_DELAY = 2.0
MAX_MATCH_DURATION = 1500
MATCH_IDLE_TIMEOUT  = 35.0

NO_MATCH_RESTART_ENABLED  = True
NO_MATCH_RESTART_TIMEOUT  = 90.0
NO_MATCH_RESTART_GRACE    = 60.0

_accept_friend_request = True
DEBUG_ALL_PACKETS = False

# Nombre de las cuentas nuevas: NICK_PREFIX + letras/números al azar.
# Ejemplo con lo de abajo: BYTRXXX_A4K9
# OJO: Free Fire NO acepta nombres de más de 12 caracteres. Si te pasas,
# el juego rechaza la cuenta. Por eso el nombre se recorta solo a 12.
NICK_PREFIX = "BYTRXXX_"
NICK_RANDOM_LEN = 4
NICK_MAX = 12


def _nuevo_apodo():
    """Arma el nombre del bot sin pasarse de 12 caracteres."""
    prefijo = NICK_PREFIX[:NICK_MAX - 1]
    largo = max(1, min(NICK_RANDOM_LEN, NICK_MAX - len(prefijo)))
    return prefijo + "".join(random.choices(string.ascii_uppercase + string.digits, k=largo))

# Si Garena o el juego rechazan al crear una cuenta, cuántas veces reintentar y cuánto esperar
CREATE_RETRIES = 10
CREATE_RETRY_WAIT = 5.0

TEAM_MODE = True
TEAM_SIZE = 4
# Los tiempos de las escuadras (pausa tras la partida, espera para aceptar, cada cuánto
# se le da a INICIAR, cuándo se arma un equipo nuevo...) están en escuadra.py → Ajustes.
CAIDA_RAPIDA_SEG = 20.0        # si lo desconectan antes de esto, cuenta como caída rápida
RECONEXION_MAX_SEG = 60.0       # espera máxima entre reconexiones si lo siguen cortando

# Reiniciar el programa entero al terminar las partidas (diseño viejo de 1 sola escuadra).
# Con varias escuadras esto las rompía: ahora cada escuadra se rearma sola.
REINICIAR_TRAS_PARTIDA = False
CLAN_ID_DEFAULT = "3105712089"
DEV_UID = ""
# ==================== MODO DE JUEGO ====================
# "br" = Battle Royale normal · "br_ranked" = BR-Clasificatoria · "lone_wolf"
GAME_MODE = "br_ranked"
# (modo, mapa). El mapa None = aleatorio, que es como va la clasificatoria.
MODOS_DE_JUEGO = {
    "br":        (1, 1),
    "br_ranked": (4, None),   # si no entra en clasificatoria prueba 3, 2, 5 o 12
    "lone_wolf": (43, 11),
}
# En cuentas de invitado la clasificatoria se abre al nivel 12.
RANKED_MIN_LEVEL = 12


def _modo_y_mapa(modo):
    return MODOS_DE_JUEGO.get(str(modo or "br"), MODOS_DE_JUEGO["br"])


def _nivel_cuenta(uid):
    try:
        return int((bot_state.accounts.get(str(uid)) or {}).get("level") or 0)
    except Exception:
        return 0


def _modo_de_escuadra(st):
    """Modo de esa escuadra. La clasificatoria solo si TODOS pasaron el nivel."""
    if GAME_MODE != "br_ranked":
        return GAME_MODE
    peers = list((st.get("peers") or {}).keys())
    if not peers:
        return "br"
    if all(_nivel_cuenta(u) >= RANKED_MIN_LEVEL for u in peers):
        return "br_ranked"
    return "br"


def _start_match_con_modo(br_hex: str, mode_id: int, map_id=None) -> bytes:
    """Arma el StartMatch de BR cambiando solo el modo y el mapa.
    El paquete empieza 08 01 12 <len> 0a 01 <mapa> 10 <modo> 3a ... y el resto
    (regiones, versión, bloques fijos) se copia tal cual."""
    raw = bytes.fromhex(br_hex)
    if raw[:5] != b"\x08\x01\x12\x80\x0a":
        return raw
    resto = raw[10:]
    cab = (b"\x0a\x01" + bytes([map_id]) if map_id else b"\x0a\x00")
    cab += b"\x10" + bytes([mode_id])
    cuerpo = cab + resto
    return b"\x08\x01\x12" + encode_varint(len(cuerpo)) + cuerpo

# ==================== MOVIMIENTO EN PARTIDA ====================
ANTI_AFK_ENABLED        = True
ANTI_AFK_TICK_HZ        = 6.0
ANTI_AFK_SPAWN_DELAY    = 5.0
ANTI_AFK_RADIUS         = 800
ANTI_AFK_SPEED          = 55
ANTI_AFK_SPRINT_SPEED   = 95
ANTI_AFK_IDLE_CHANCE    = 0.08
ANTI_AFK_SPRINT_CHANCE  = 0.35
ANTI_AFK_DECISION_SEC   = 2.5
ANTI_AFK_PING_EVERY     = 4.0
ANTI_AFK_JUMP_EVERY     = 20.0

# Origen del mapa. El bot arrancaba en 0,0, que es la esquina: por eso no se movía.
# Si aparece en el agua o en el vacío, sube o baja estos dos números.
MOVEMENT_ORIGIN_X       = 400000.0
MOVEMENT_ORIGIN_Y       = 400000.0
MOVEMENT_ORIGIN_JITTER  = 120.0
MOVEMENT_MSG_KEY        = 0x6B
MOVEMENT_SEND_OPTION    = 1
DEBUG_MOVEMENT_HEX      = True
# Si el servidor no devuelve nada, se prueban estas opciones en orden.
MOVEMENT_SEND_OPTIONS   = [1, 2, 0]
MOVEMENT_CONFIRM_AFTER  = 12      # envíos sin eco antes de cambiar de opción
MOVEMENT_START_DELAY    = 1.5     # respiro después de entrar, antes del primer 2001
MOVEMENT_DYNAMIC_HEADING = False  # True = el personaje gira hacia donde camina
# Cmds con los que el servidor puede reflejar el estado del jugador.
MOVEMENT_ECHO_CMDS      = (2001, 2002, 2012, 2014)

ANALOG_DIRECTIONS = [
    (0.0,  1.0, "maju"), (0.0, -1.0, "mundur"),
    (-1.0, 0.0, "kiri"), (1.0,  0.0, "kanan"),
    (-0.7, 0.7, "maju-kiri"), (0.7,  0.7, "maju-kanan"),
    (-0.7,-0.7, "mundur-kiri"), (0.7, -0.7, "mundur-kanan"),
    (0.0,  0.0, "idle"),
]

ENABLE_SPEED_MOVEMENT       = True
MOVEMENT_SPEED_MIN          = 1.0
MOVEMENT_SPEED_MAX          = 1.4
MOVEMENT_PATTERN            = "circle"
MOVEMENT_TICK_MS            = 160
MOVEMENT_RADIUS             = 500
MOVEMENT_UPDATE_SPEED_EVERY = 4.0

MOVEMENT_STATE_IDLE_CHANCE   = 0.10
MOVEMENT_STATE_WALK_CHANCE   = 0.28
MOVEMENT_STATE_RUN_CHANCE    = 0.32
MOVEMENT_STATE_SPRINT_CHANCE = 0.10
MOVEMENT_STATE_JUMP_CHANCE   = 0.08
MOVEMENT_STATE_CROUCH_CHANCE = 0.06
MOVEMENT_STATE_PRONE_CHANCE  = 0.06

PLAYER_STATE_MAP = {"idle":0,"walk":1,"run":1,"sprint":1,"jump":2,"crouch":3,"prone":4}
MOVE_STATE_MAP   = {"idle":0,"walk":1,"run":2,"sprint":3,"jump":4,"crouch":1,"prone":1}
STATE_SPEED      = {"idle":0,"walk":140,"run":500,"sprint":650,"jump":300,"crouch":80,"prone":0}

ENABLE_NEWBIE_CHARACTER     = False
NEWBIE_SELECT_BEFORE_TEAM   = False
NEWBIE_SELECT_DELAY         = 1.5
NEWBIE_SELECT_RETRY         = 2
NEWBIE_SELECT_WAIT_AFTER    = 2.0
NEWBIE_ITEM_ID_1            = 102000011
NEWBIE_ITEM_ID_2            = 102000026
NEWBIE_ITEM_ID_3            = 102000037
NEWBIE_ITEM_ID_EXTRA        = 102000023
NEWBIE_SUB4_FIELD_3         = 50
NEWBIE_SUB4_FIELD_5_2       = 4806
NEWBIE_SUB4_FIELD_8         = 1
NEWBIE_SUB4_FIELD_11        = 11679599800712232

AES_KEY = bytes([89, 103, 38, 116, 99, 37, 68, 69, 117, 104, 54, 37, 90, 99, 94, 56])
AES_IV  = bytes([54, 111, 121, 90, 68, 114, 50, 50, 69, 51, 121, 99, 104, 106, 77, 37])
KEYSTREAM = bytes([0x30,0x30,0x30,0x32,0x30,0x31,0x37,0x30,0x30,0x30,0x30,0x30,0x32,0x30,0x31,0x37,0x30,0x30,0x30,0x30,0x30,0x32,0x30,0x31,0x37,0x30,0x30,0x30,0x30,0x30,0x32,0x30])
HEX_KEY = "2ee44819e9b4598845141067b281621874d0d5d7af9d8f7e00c1e54715b7d1e3"
API_KEY = HEX_KEY.encode()

REGION_LANG = {"ME":"ar","IND":"hi","ID":"id","VN":"vi","TH":"th","BD":"bn",
               "PK":"ur","TW":"zh","RU":"ru","SAC":"es","BR":"pt","NA":"pt",
               "SG":"pt","US":"pt"}

# ╔══════════════════════════════════════════════════════════════════════╗
# ║   ✦  COLORES Y DISEÑO DE LA CONSOLA  ✦                              ║
# ╚══════════════════════════════════════════════════════════════════════╝

class PX:
    """Colores para la consola."""
    RESET   = "\033[0m"
    BOLD    = "\033[1m"
    DIM     = "\033[2m"
    ITALIC  = "\033[3m"
    UNDER   = "\033[4m"
    BLINK   = "\033[5m"

    GOLD    = "\033[38;5;220m"
    AMBER   = "\033[38;5;214m"
    ROSE    = "\033[38;5;204m"
    MAGENTA = "\033[38;5;200m"
    VIOLET  = "\033[38;5;135m"
    INDIGO  = "\033[38;5;99m"
    CYAN    = "\033[38;5;51m"
    TEAL    = "\033[38;5;44m"
    MINT    = "\033[38;5;121m"
    LIME    = "\033[38;5;118m"
    EMERALD = "\033[38;5;48m"
    SKY     = "\033[38;5;117m"
    SLATE   = "\033[38;5;245m"
    SILVER  = "\033[38;5;250m"
    WHITE   = "\033[38;5;255m"
    CRIMSON = "\033[38;5;197m"
    CORAL   = "\033[38;5;209m"
    PEACH   = "\033[38;5;216m"
    BG_DARK = "\033[48;5;236m"

I = {
    "ok":"◈","err":"◇","warn":"◉","info":"◎","star":"✦","spark":"✧",
    "dot":"•","arrow":"▸","check":"✔","cross":"✘","bolt":"⚡","flame":"🔥",
    "gem":"💎","crown":"👑","shield":"🛡","rocket":"🚀","target":"🎯","pulse":"◐",
}

def _ts(): return datetime.now().strftime("%H:%M:%S")

def _fmt(msg, color, icon, tag, level_style=""):
    ts    = f"{PX.SLATE}{_ts()}{PX.RESET}"
    badge = f"{color}{PX.BOLD}╭─{icon}─╮{PX.RESET}"
    label = f"{color}{PX.BOLD}{tag}{PX.RESET}"
    body  = f"{level_style}{PX.SILVER}{msg}{PX.RESET}"
    return f"{ts} {badge} {label} {PX.DIM}{PX.SLATE}▸{PX.RESET} {body}"

def print_success(t):
    print(_fmt(t, PX.EMERALD, I["ok"], "OK   "))
    try: bot_state.log(t, "success")
    except Exception: pass

def print_error(t):
    print(_fmt(t, PX.CRIMSON, I["err"], "FAIL "))
    try: bot_state.log(t, "error")
    except Exception: pass

def print_warning(t):
    print(_fmt(t, PX.AMBER, I["warn"], "WARN "))
    try: bot_state.log(t, "warning")
    except Exception: pass

def print_info(t):
    print(_fmt(t, PX.CYAN, I["info"], "INFO "))
    try: bot_state.log(t, "info")
    except Exception: pass

def print_premium(t, color=PX.GOLD, icon=I["star"], tag="EVENTO"):
    print(_fmt(t, color, icon, f"{tag:<5}"))
    try: bot_state.log(t, "info")
    except Exception: pass

def print_rule(title="", width=72, color=PX.VIOLET):
    if title:
        pad = max(0, width - len(title) - 6)
        left = pad // 2; right = pad - left
        print(f"{color}{'═'*left}❰ {PX.BOLD}{title}{PX.RESET}{color} ❱{'═'*right}{PX.RESET}")
    else:
        print(f"{color}{'═'*width}{PX.RESET}")

def print_box(title, lines, color=PX.GOLD, width=68):
    print(f"{color}╔{'═'*(width-2)}╗{PX.RESET}")
    print(f"{color}║ {PX.BOLD}{title.center(width-4)}{PX.RESET}{color} ║{PX.RESET}")
    print(f"{color}╟{'─'*(width-2)}╢{PX.RESET}")
    for l in lines:
        body = str(l)[:width-4]
        print(f"{color}║{PX.RESET} {PX.SILVER}{body:<{width-4}}{PX.RESET} {color}║{PX.RESET}")
    print(f"{color}╚{'═'*(width-2)}╝{PX.RESET}")

def print_banner():
    R = PX.RESET; b = PX.BOLD
    gold, rose, cyan, violet, silver, teal = PX.GOLD, PX.ROSE, PX.CYAN, PX.VIOLET, PX.SILVER, PX.TEAL
    print()
    print(f"{violet}    ╔══════════════════════════════════════════════════════════╗{R}")
    print(f"{violet}    ║{R}   {gold}{b}✦  G U I L D   G L O R Y   ✦{R}   {rose}{b}B O T{R}       {violet}║{R}")
    print(f"{violet}    ╠══════════════════════════════════════════════════════════╣{R}")
    print(f"{violet}    ║{R}   {cyan}▸ Escuadra de 4 bots para Free Fire{R}                     {violet}║{R}")
    print(f"{violet}    ║{R}   {silver}▸ Crea cuentas · Entra al clan · Juega en equipo{R}        {violet}║{R}")
    print(f"{violet}    ║{R}   {teal}▸ Versión 2.0  ·  Python 3.10+{R}                         {violet}║{R}")
    print(f"{violet}    ╚══════════════════════════════════════════════════════════╝{R}")
    print(f"{PX.SLATE}              Basado en RAFIN TxT · © 2026{R}")
    print()

# ==================== ESTADO ====================
class BotState:
    def __init__(self):
        self.accounts: Dict[str, dict] = {}
        self.account_credentials: Dict[str, dict] = {}
        self.account_workers: Dict[str, asyncio.Task] = {}
        self.auth_to_game_id: Dict[str, str] = {}
        self.game_to_auth_id: Dict[str, str] = {}
        self.account_token_map: Dict[str, str] = {}
        self.paused: set = set()
        self.writers: Dict[str, list] = {}
        self.logs: List[dict] = []
        self.total_matches = 0
        self.matches_started = 0
        self.total_exp_gained = 0
        self.create_progress: List[str] = []
        self.creating = False
        self.start_time = time.time()
        self._writer_lock = asyncio.Lock()

    def log(self, msg, level="info"):
        try:
            t = datetime.now().strftime("%H:%M:%S")
            self.logs.append({"t": time.time(), "time": t, "message": str(msg), "level": level})
            if len(self.logs) > 500:
                self.logs = self.logs[-500:]
        except Exception: pass

    def register_account(self, uid, nickname, region="ID", level=1, exp=0,
                         likes=0, token=None, auth_uid=None):
        uid = str(uid)
        existing = self.accounts.get(uid, {})
        self.accounts[uid] = {
            "uid": uid, "nickname": nickname, "region": region,
            "level": level, "exp": exp, "likes": likes,
            "token": token, "auth_uid": auth_uid,
            "status": "ONLINE", "current_exp": exp,
            "initial_exp": existing.get("initial_exp", exp),
            "gained_exp": existing.get("gained_exp", 0),
            "matches": existing.get("matches", 0),
            "active_matches": 0,
            "uptime_seconds": existing.get("uptime_seconds", 0),
            "last_match_time": existing.get("last_match_time", "Running..."),
            "is_paused": False,
        }

    def update_status(self, uid, status, matches=0):
        uid = str(uid)
        if uid in self.accounts:
            self.accounts[uid]["status"] = status
            self.accounts[uid]["active_matches"] = matches
            self.accounts[uid]["is_paused"] = (status == "PAUSED")

    def update_exp(self, uid, exp, level=None):
        uid = str(uid)
        if uid in self.accounts:
            a = self.accounts[uid]
            old = a.get("current_exp", 0)
            if exp > old:
                a["gained_exp"] = a.get("gained_exp", 0) + (exp - old)
                self.total_exp_gained += (exp - old)
            a["current_exp"] = exp; a["exp"] = exp
            if level: a["level"] = level

    def increment_match(self, uid):
        self.total_matches += 1
        uid = str(uid)
        if uid in self.accounts:
            self.accounts[uid]["matches"] = self.accounts[uid].get("matches", 0) + 1
            self.accounts[uid]["last_match_time"] = datetime.now().strftime("%H:%M:%S")

    def increment_match_started(self): self.matches_started += 1
    def register_writer(self, uid, w): self.writers.setdefault(str(uid), []).append(w)
    def unregister_writer(self, uid, w):
        try: self.writers.get(str(uid), []).remove(w)
        except Exception: pass
    def close_writers_for_account(self, uid):
        for w in list(self.writers.get(str(uid), [])):
            try: w.close()
            except Exception: pass
        self.writers[str(uid)] = []
    def is_paused(self, uid): return str(uid) in self.paused
    def toggle_pause(self, uid, state):
        uid = str(uid)
        if state:
            self.paused.add(uid)
            if uid in self.accounts:
                self.accounts[uid]["is_paused"] = True
                self.accounts[uid]["status"] = "PAUSED"
        else:
            self.paused.discard(uid)
            if uid in self.accounts:
                self.accounts[uid]["is_paused"] = False
                if self.accounts[uid].get("status") == "PAUSED":
                    self.accounts[uid]["status"] = "ONLINE"

bot_state = BotState()

# ==================== ESCUADRAS (los bots se reparten de 4 en 4) ====================
# Un equipo de Free Fire solo tiene 4 lugares. Si hay más bots, se arman varias
# escuadras: cada una con su propio líder, su propio código y su propia partida.
_squads: Dict[str, dict] = {}      # "E1" -> estado de esa escuadra
_squad_of: Dict[str, str] = {}     # bot -> nombre de su escuadra
_orden_cache = {"mtime": None, "uids": [], "esc": {}}
_cuentas_lock = asyncio.Lock()


def _leer_cuentas():
    try:
        if os.path.exists(ACCOUNTS_FILE):
            with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, list):
                return [a for a in d if isinstance(a, dict)]
    except Exception as e:
        print_warning(f"[ESCUADRAS] No se pudo leer {ACCOUNTS_FILE}: {e}")
    return []


def _guardar_cuentas(lista):
    tmp = ACCOUNTS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lista, f, indent=2)
    os.replace(tmp, ACCOUNTS_FILE)
    _orden_cache["mtime"] = None   # que se vuelva a leer


def _uids_guardados():
    """Las cuentas en orden y a qué escuadra pertenece cada una."""
    try:
        mt = os.path.getmtime(ACCOUNTS_FILE) if os.path.exists(ACCOUNTS_FILE) else None
        if mt != _orden_cache["mtime"]:
            uids, esc = [], {}
            if mt:
                for i, a in enumerate(_leer_cuentas()):
                    if not a.get("uid"):
                        continue
                    u = str(a["uid"])
                    uids.append(u)
                    esc[u] = str(a.get("squad") or "").strip() or f"E{i // TEAM_SIZE + 1}"
            _orden_cache["uids"] = uids
            _orden_cache["esc"] = esc
            _orden_cache["mtime"] = mt
    except Exception:
        pass
    return _orden_cache["uids"]


def _escuadra_guardada(auth_uid):
    _uids_guardados()
    return _orden_cache["esc"].get(str(auth_uid))


def _fijar_escuadras_en_archivo():
    """La primera vez le escribe a cada cuenta su escuadra, para que no se muevan después."""
    lista = _leer_cuentas()
    if not lista:
        return
    cambio = False
    for i, a in enumerate(lista):
        if not str(a.get("squad") or "").strip():
            a["squad"] = f"E{i // TEAM_SIZE + 1}"
            cambio = True
    if cambio:
        try:
            _guardar_cuentas(lista)
            print_info(f"[ESCUADRAS] Se repartieron {len(lista)} cuentas en escuadras de {TEAM_SIZE}")
        except Exception as e:
            print_warning(f"[ESCUADRAS] No se pudo guardar el reparto: {e}")


def _escuadras_del_archivo():
    """{'E1': [uid, uid...], ...} en orden."""
    _uids_guardados()
    grupos: Dict[str, list] = {}
    for u in _orden_cache["uids"]:
        grupos.setdefault(_orden_cache["esc"].get(u) or "E1", []).append(u)
    return dict(sorted(grupos.items(), key=_clave_orden_escuadra))


def _clave_orden_escuadra(par):
    n = str(par[0] if isinstance(par, tuple) else par)
    try:
        return (0, int(n[1:])) if n.startswith("E") and n[1:].isdigit() else (1, 0)
    except Exception:
        return (1, 0)


def _nombre_escuadra(uid):
    """A qué escuadra le toca ese bot."""
    uid = str(uid)
    auth = str(bot_state.game_to_auth_id.get(uid, uid))
    for clave in (auth, uid):
        g = _escuadra_guardada(clave)
        if g:
            return g
    # Cuenta suelta (agregada a mano): entra en la primera escuadra con lugar
    i = 1
    while True:
        st = _squads.get(f"E{i}")
        if st is None or len(st["peers"]) < TEAM_SIZE:
            return f"E{i}"
        i += 1


def _estado_escuadra(uid):
    """El estado (miembros, líder, código) de la escuadra de ese bot."""
    uid = str(uid)
    nombre = _squad_of.get(uid)
    if not nombre:
        nombre = _nombre_escuadra(uid)
        _squad_of[uid] = nombre
    return _estado_por_nombre(nombre)


def _estado_por_nombre(nombre):
    nombre = str(nombre)
    st = _squads.get(nombre)
    if st is None:
        st = {"nombre": nombre, "peers": {}, "leader_uid": None, "team_code": None,
              "lock": asyncio.Lock(),
              # para que puedas entrar tú: espera antes de buscar partida e invitación pendiente
              "esperar_hasta": 0.0, "esperar_pendiente": False,
              "esperar_min": 5.0, "invitar_uid": None}
        _squads[nombre] = st
    return st


def _etiqueta_escuadra(nombre):
    n = str(nombre or "")
    return f"Escuadra {n[1:]}" if n.startswith("E") and n[1:].isdigit() else f"Escuadra {n}"


def _bots_de_escuadra(nombre):
    """Cuántos bots le tocan a esa escuadra (puede tener menos de 4)."""
    cuantos = len(_escuadras_del_archivo().get(str(nombre)) or [])
    return cuantos if cuantos >= 1 else TEAM_SIZE


def _fase(st, fase):
    """Anota en qué está la escuadra (para el panel): esperando, armando, buscando, en_partida."""
    if st.get("fase") != fase:
        st["fase"] = fase
        st["fase_desde"] = time.time()


async def _toca_esperarte(st, etiqueta, uid_str):
    """True si esa escuadra tiene que quedarse quieta porque pediste entrar tú."""
    if st.get("esperar_pendiente"):
        st["esperar_pendiente"] = False
        st["esperar_hasta"] = time.time() + float(st.get("esperar_min") or 5) * 60
        print_info(f"[EQUIPO] {etiqueta}: terminó la partida, ahora te espera "
                   f"{float(st.get('esperar_min') or 5):g} min")
    quedan = float(st.get("esperar_hasta") or 0) - time.time()
    if quedan <= 0:
        return False
    try:
        bot_state.update_status(uid_str, "ONLINE", 0)
    except Exception:
        pass
    if not st.get("_aviso_espera") or time.time() - float(st.get("_aviso_espera") or 0) > 20:
        st["_aviso_espera"] = time.time()
        print_info(f"[EQUIPO] {etiqueta}: esperándote para buscar partida "
                   f"(código {st.get('team_code') or 'todavía no llega'}, {int(quedan)} s)")
    return True


def _en_alguna_escuadra(uid):
    uid = str(uid)
    return any(uid in st["peers"] for st in _squads.values())


_restart_state = {"lock": asyncio.Lock(), "finished_bots": set(), "target": None, "restarting": False}

async def _mark_bot_match_finished(account_id):
    """Un bot terminó su partida. Su escuadra se rearma sola; no se reinicia nada."""
    if not REINICIAR_TRAS_PARTIDA:
        return
    async with _restart_state["lock"]:
        if _restart_state["restarting"]: return
        _restart_state["finished_bots"].add(str(account_id))
        n_done = len(_restart_state["finished_bots"])
        if _restart_state["target"] is None:
            active_ids = {uid for uid, a in bot_state.accounts.items() if a.get("status") not in ("OFFLINE",)}
            _restart_state["target"] = max(1, min(TEAM_SIZE, len(active_ids))) if active_ids else TEAM_SIZE
        target = _restart_state["target"]
        print_success(f"[REINICIO] {account_id} → {n_done}/{target}")
        if n_done >= target:
            _restart_state["restarting"] = True
            print_warning(f"[REINICIO] ✅ Los {target} bots terminaron; se reinicia en 3 s...")
            asyncio.create_task(_schedule_restart())

_no_match_state = {"lock": asyncio.Lock(), "global_last_match": None, "restart_triggered": False}
async def _mark_match_found(account_id=None):
    async with _no_match_state["lock"]:
        _no_match_state["global_last_match"] = time.time()

_ALLOWED_RESTART_STATUSES = {"ONLINE", "SEARCHING"}
_team_stuck_state = {"lock": asyncio.Lock(), "in_team_since": {}, "triggered": False}

async def _mark_team_joined(uid):
    uid = str(uid)
    async with _team_stuck_state["lock"]:
        if uid not in _team_stuck_state["in_team_since"]:
            _team_stuck_state["in_team_since"][uid] = time.time()
            print_info(f"[EQUIPO] {uid} entró al equipo (iba atascado)")

async def _clear_team_joined(uid):
    uid = str(uid)
    async with _team_stuck_state["lock"]:
        if uid in _team_stuck_state["in_team_since"]:
            del _team_stuck_state["in_team_since"][uid]

async def _team_member_count() -> int:
    """Cuántos miembros tiene la escuadra más llena (para saber si hay un equipo completo)."""
    return max((len(st["peers"]) for st in _squads.values()), default=0)

def _all_bots_are_online_or_searching() -> bool:
    active_statuses = []
    for uid, acc in bot_state.accounts.items():
        status = str(acc.get("status", "")).upper().strip()
        if status in ("", "OFFLINE"): continue
        active_statuses.append(status)
    if not active_statuses: return False
    return all(st in _ALLOWED_RESTART_STATUSES for st in active_statuses)

def _any_bot_in_match() -> bool:
    for uid, acc in bot_state.accounts.items():
        if "IN_MATCH" in str(acc.get("status", "")).upper(): return True
    return False

async def _no_match_watchdog():
    """Avisa si una escuadra lleva mucho rato sin partida. Ya no reinicia el programa:
    cada escuadra arma su equipo de nuevo sola cuando no encuentra."""
    await asyncio.sleep(NO_MATCH_RESTART_GRACE)
    print_info(f"[SIN PARTIDA] Vigilancia activa: avisa si una escuadra pasa "
               f"{NO_MATCH_RESTART_TIMEOUT:.0f} s sin partida")
    avisadas = {}
    while True:
        await asyncio.sleep(20.0)
        try:
            ahora = time.time()
            for nombre, st in list(_squads.items()):
                peers = st.get("peers") or {}
                if not peers:
                    avisadas.pop(nombre, None); continue
                jugando = any("IN_MATCH" in str((bot_state.accounts.get(str(u)) or {})
                                                .get("status", "")).upper() for u in peers)
                if jugando or float(st.get("esperar_hasta") or 0) > ahora:
                    st["sin_partida_desde"] = ahora
                    avisadas.pop(nombre, None)
                    continue
                desde = float(st.get("sin_partida_desde") or 0)
                if not desde:
                    st["sin_partida_desde"] = ahora; continue
                pasado = ahora - desde
                if pasado >= NO_MATCH_RESTART_TIMEOUT and ahora - avisadas.get(nombre, 0) > 300:
                    avisadas[nombre] = ahora
                    print_warning(f"[SIN PARTIDA] {_etiqueta_escuadra(nombre)} lleva "
                                  f"{pasado / 60:.0f} min sin partida ({len(peers)} bots conectados)")
        except Exception as e:
            print_warning(f"[SIN PARTIDA] Error: {e}")

async def _schedule_restart():
    await asyncio.sleep(3.0)
    print_warning("[REINICIO] 🔄 Reiniciando el programa completo...")
    try: sys.stdout.flush(); sys.stderr.flush()
    except Exception: pass
    try: os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        print_error(f"[REINICIO] No se pudo reiniciar: {e}")
        try:
            subprocess.Popen([sys.executable] + sys.argv); os._exit(0)
        except Exception as e2:
            print_error(f"[REINICIO] Error al reiniciar: {e2}"); os._exit(1)

# ── Backward-compat alias (পুরনো কোডে C.GREEN ইত্যাদি ব্যবহৃত হলে) ──
class C:
    GREEN=PX.EMERALD; FAIL=PX.CRIMSON; WARNING=PX.AMBER
    CYAN=PX.CYAN; MAGENTA=PX.MAGENTA; WHITE=PX.WHITE; ENDC=PX.RESET

GGRE_RAW = bytes.fromhex(
    "47475245010101006d020000b260ee08e1f86b4c57f9c70f86bba26ed5d1436bcf52e142db3249d905eded757764991ca31a8373cdd26eab91b80f3f1f6f262f4f10b895d7b6937ddba30a27197453890e9da49373f736c679b8254e2f8e1623e91084a5fdd5374fe478ff99e010834553fddeb0bec4018d142e49df9bb236675b67e852f92a43586f7a7d4d0d7a197a1d4da32714dab4d069ad53214e2c33b3877420a12459738c4c619cbd815fa878bbd104776bb3e1ac7818d5397b04a666ac57f682763ff2df31bc2f846ddc7904f3dce1bda0c4b01f9698e9166f98c84f92640abe3f6317834a42e5c12573b46842c1a6ea8fe6ca9c006dca48a2087e1f983dfb5692771e4a0b15b337ad669b1d08b40862b176bace5331b49a767375b1a8469012aa70a67b55fe71b72478201d0b3ac7269c064c960361e92ee7ba8a42cc6b582bf9b965fb388fa9172ad44c4b073ac23c02080a6bcd106b691ffdf4c7cf71e42f2063fcf196e9bddc5e85be1fe5048eb1b31b460efbb46d76195eef9904c4cba326f2e17ff51fec17dd965aa06dadd4ab07d6966e4a7c38e8afd66dfde56c872bb87516a8f7313c797e4d80e5ad4a5f7afad95c1e0449254adae052e71a3fb98399f93ab30848e0d23252dd45e6fd41bc5fa7303dfb846a8fd713a0032a0b0ae96dfba1bbe41d20abd8099e2cb7fccc329d25bd153029139ef05d090a5093ea557693c0a8d491395b8a23ca844b3887dd5dfc29ac06f4b9be87883a793211b973465e2644c4f5de02b8ab01571401203fc2740423826858cc6da0194c195d27aac4ec4b9d23d506c1501d06440aca3fc180926d75d4a004d3dff21eb4ea1e8c86e6c9627248eff953e1d192d5c8efc006a7e512388ef2ebdb72ee3ad42d719f28e8f994e12ebf4c79f2ffe3abd7408ccd2236a7b89b2606247a732c10c4"
)

def _encode_proto_std(fields):
    out = b""
    for f in sorted(fields.keys()):
        v = fields[f]
        if isinstance(v, bool):
            out += encode_varint((f << 3) | 0) + encode_varint(int(v))
        elif isinstance(v, int):
            out += encode_varint((f << 3) | 0) + encode_varint(v)
        elif isinstance(v, (str, bytes)):
            if isinstance(v, str): v = v.encode()
            out += encode_varint((f << 3) | 2) + encode_varint(len(v)) + v
    return out

# ==================== DISPOSITIVO ====================
def _generate_new_device() -> dict:
    device_list = [
        ("Samsung","SM-G998B","Adreno (TM) 660","Android OS 12 / API-31"),
        ("Xiaomi","2201122G","Adreno (TM) 730","Android OS 13 / API-33"),
        ("Realme","RMX3700","Mali-G710","Android OS 14 / API-34"),
        ("OnePlus","CPH2451","Adreno (TM) 740","Android OS 13 / API-33"),
        ("OPPO","CPH2611","Adreno (TM) 720","Android OS 14 / API-34"),
    ]
    brand, model, gpu, os_ver = random.choice(device_list)
    return {"unique_device_id":f"Google|{uuid.uuid4()}","brand":brand,"model":model,
            "gpu_renderer":gpu,"system_software":os_ver,
            "screen_width":random.choice([1080,1440,720]),
            "screen_height":random.choice([2400,3200,1600]),
            "screen_dpi":str(random.randint(300,420)),
            "memory":random.randint(2800,6500)}

def get_device_for_account(acc_key: str) -> dict:
    devices = {}
    if os.path.exists(DEVICES_FILE):
        try:
            with open(DEVICES_FILE,"r",encoding="utf-8") as f:
                devices = json.load(f)
                if not isinstance(devices, dict): devices = {}
        except Exception: devices = {}
    if acc_key in devices: return devices[acc_key]
    nd = _generate_new_device(); devices[acc_key] = nd
    try:
        with open(DEVICES_FILE,"w",encoding="utf-8") as f:
            json.dump(devices, f, indent=2)
    except Exception: pass
    return nd

def encode_f14(s):
    ks = [0x30,0x30,0x30,0x32,0x30,0x31,0x37,0x30,
          0x30,0x30,0x30,0x30,0x32,0x30,0x31,0x37,
          0x30,0x30,0x30,0x30,0x30,0x32,0x30,0x31,
          0x37,0x30,0x30,0x30,0x30,0x30,0x32,0x30]
    return bytes(ord(c) ^ ks[i % len(ks)] for i, c in enumerate(s))

# ==================== DNS ====================
_DNS_CACHE: Dict[str, Tuple[str,float]] = {}
_DNS_CACHE_TTL = 300.0

async def resolve_host_cloudflare(hostname: str) -> str:
    if not hostname: return hostname
    parts = hostname.split('.')
    if len(parts)==4 and all(p.isdigit() for p in parts): return hostname
    now = time.time()
    if hostname in _DNS_CACHE:
        ip, exp = _DNS_CACHE[hostname]
        if now < exp: return ip
    try:
        loop = asyncio.get_running_loop()
        info = await loop.getaddrinfo(hostname, None, family=socket.AF_INET)
        if info:
            ip = info[0][4][0]
            _DNS_CACHE[hostname] = (ip, now + _DNS_CACHE_TTL); return ip
    except Exception: pass
    return hostname

def optimize_tcp_socket(sock):
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 131072)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 131072)
    except Exception: pass

async def safe_close_writer(writer):
    if not writer: return
    try:
        if not writer.is_closing(): writer.close()
        await asyncio.wait_for(writer.wait_closed(), timeout=1.5)
    except Exception: pass

def optimize_udp_socket(sock):
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 131072)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 131072)
    except Exception: pass

client = httpx.AsyncClient(verify=False, timeout=15.0,
    limits=httpx.Limits(max_connections=300, max_keepalive_connections=150))
_LOGIN_SEMAPHORE = asyncio.Semaphore(4)

# ==================== CIFRADO ====================
CRC7_TABLE = bytes([
    0,9,18,27,36,45,54,63,72,65,90,83,108,101,126,119,
    25,16,11,2,61,52,47,38,81,88,67,74,117,124,103,110,
    50,59,32,41,22,31,4,13,122,115,104,97,94,87,76,69,
    43,34,57,48,15,6,29,20,99,106,113,120,71,78,85,92,
    100,109,118,127,64,73,82,91,44,37,62,55,8,1,26,19,
    125,116,111,102,89,80,75,66,53,60,39,46,17,24,3,10,
    86,95,68,77,114,123,96,105,30,23,12,5,58,51,40,33,
    79,70,93,84,107,98,121,112,7,14,21,28,35,42,49,56,
    65,72,83,90,101,108,119,126,9,0,27,18,45,36,63,54,
    88,81,74,67,124,117,110,103,16,25,2,11,52,61,38,47,
    115,122,97,104,87,94,69,76,59,50,41,32,31,22,13,4,
    106,99,120,113,78,71,92,85,34,43,48,57,6,15,20,29,
    37,44,55,62,1,8,19,26,109,100,127,118,73,64,91,82,
    60,53,46,39,24,17,10,3,116,125,102,111,80,89,66,75,
    23,30,5,12,51,58,33,40,95,86,77,68,123,114,105,96,
    14,7,28,21,42,35,56,49,70,79,84,93,98,107,112,121,
])
_DELTA = 0x9E3779B9
_ROUNDS = 16
_FIELD_SIZES = {0:1,1:2,2:2,3:1,4:2}
_FIELD_NAMES = {0:"sendOption",1:"cmd",2:"orderId",3:"flags",4:"length"}

def crc7_sync(data: bytes) -> int:
    c = 0
    for b in data:
        c = CRC7_TABLE[((2*(c & 0xFF)) ^ (b & 0xFF)) & 0xFF] & 0x7F
    return c & 0x7F

def encode_varint(n: int) -> bytes:
    out = bytearray()
    if n < 0: n &= 0xFFFFFFFFFFFFFFFF
    while True:
        b = n & 0x7F; n >>= 7
        if n: b |= 0x80
        out.append(b)
        if not n: break
    return bytes(out)

def _pb_varint(fn, val): return encode_varint((fn<<3)|0) + encode_varint(val)
def _pb_length(fn, val):
    enc = val.encode('utf-8') if isinstance(val,str) else val
    return encode_varint((fn<<3)|2) + encode_varint(len(enc)) + enc

def create_proto(fields) -> bytes:
    packet = bytearray()
    for field, value in fields.items():
        if isinstance(field, str): field = int(field)
        if isinstance(value, dict):
            packet.extend(_pb_length(field, bytes(create_proto(value))))
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    packet.extend(_pb_length(field, bytes(create_proto(item))))
                elif isinstance(item, str):
                    packet.extend(_pb_length(field, item))
                elif isinstance(item, (bytes, bytearray)):
                    packet.extend(_pb_length(field, bytes(item)))
                elif isinstance(item, bool):
                    packet.extend(_pb_varint(field, 1 if item else 0))
                elif isinstance(item, int):
                    packet.extend(_pb_varint(field, item))
        elif isinstance(value, bool):
            packet.extend(_pb_varint(field, 1 if value else 0))
        elif isinstance(value, int):
            packet.extend(_pb_varint(field, value))
        elif isinstance(value, str):
            packet.extend(_pb_length(field, value))
        elif isinstance(value, (bytes, bytearray)):
            packet.extend(_pb_length(field, bytes(value)))
    return bytes(packet)

def encrypt_aes(hex_data: str) -> str:
    cipher = AES.new(AES_KEY, AES.MODE_CBC, AES_IV)
    return cipher.encrypt(pad(bytes.fromhex(hex_data), AES.block_size)).hex()

def decode_varint(data, offset):
    result = 0; shift = 0
    while offset < len(data):
        byte = data[offset]
        result |= (byte & 0x7F) << shift
        offset += 1
        if not (byte & 0x80): return result, offset
        shift += 7
    return None, offset

def decode_protobuf_2(data):
    result = {}; offset = 0; data_len = len(data)
    while offset < data_len:
        header, offset = decode_varint(data, offset)
        if header is None: break
        fn = header >> 3; wt = header & 0x7
        if wt == 0:
            v, offset = decode_varint(data, offset)
            if v is not None: result[fn] = v
        elif wt == 2:
            length, offset = decode_varint(data, offset)
            if length is None: break
            value = data[offset:offset+length]; offset += length
            try:
                s = value.decode('utf-8')
                result[fn] = s if s else value.hex()
            except UnicodeDecodeError:
                nested = decode_protobuf_2(value)
                result[fn] = nested if nested else value.hex()
        elif wt == 1: offset += 8
        elif wt == 3: offset += 4
        else: break
    return result

def extract_raw_fields(data: bytes) -> dict:
    result = {}; offset = 0; data_len = len(data)
    while offset < data_len:
        header, offset = decode_varint(data, offset)
        if header is None: break
        fn = header >> 3; wt = header & 0x7
        if wt == 0:
            v, offset = decode_varint(data, offset)
            if v is not None: result[fn] = v
        elif wt == 2:
            length, offset = decode_varint(data, offset)
            if length is None: break
            if offset + length > data_len: break
            result[fn] = bytes(data[offset:offset+length]); offset += length
        elif wt == 1: offset += 8
        elif wt == 3: offset += 4
        else: break
    return result

def _parse_results_sync(results):
    out = {}
    for r in results:
        fd = {"wire_type": r.wire_type}
        if r.wire_type == "varint": fd["data"] = r.data
        elif r.wire_type in ("string","bytes"): fd["data"] = r.data
        elif r.wire_type == "length_delimited":
            if hasattr(r.data, "results"): fd["data"] = _parse_results_sync(r.data.results)
            elif isinstance(r.data, list): fd["data"] = _parse_results_sync(r.data)
            else: fd["data"] = str(r.data)
        out[str(r.field)] = fd
    return out

def decode_protobuf_dict(data: bytes) -> dict:
    try:
        parsed = Parser().parse(data)
        return _parse_results_sync(parsed)
    except Exception: return {}

async def decode_protobuf_async(data):
    try:
        parsed = Parser().parse(data)
        return json.dumps(_parse_results_sync(parsed))
    except Exception: return "{}"

# ==================== ZIGZAG / ULEB ====================
async def has_ssan_zig(n: int) -> bytes:
    try: n = int(n)
    except Exception: n = 0
    z = (n << 1) & 0xFFFFFFFFFFFFFFFF
    out = bytearray()
    while z >= 0x80:
        out.append((z & 0x7F) | 0x80); z >>= 7
    out.append(z); return bytes(out)

async def uleb_encode(n: int) -> bytes:
    try: n = int(n)
    except Exception: n = 0
    if n < 0: n &= 0xFFFFFFFFFFFFFFFF
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        if n: b |= 0x80
        out.append(b)
        if not n: break
    return bytes(out)

async def zigzag_encode_signed(n: int) -> bytes:
    try: n = int(n)
    except Exception: n = 0
    zz = (n << 1) ^ (n >> 63)
    if zz < 0: zz = -zz
    zz &= 0xFFFFFFFFFFFFFFFF
    out = bytearray()
    while True:
        b = zz & 0x7F; zz >>= 7
        if zz: b |= 0x80
        out.append(b)
        if not zz: break
    return bytes(out)

def create_packet(Pk, N, K, V):
    if isinstance(K, str): K = bytes.fromhex(K) if len(K)==32 else K.encode()
    if isinstance(V, str): V = bytes.fromhex(V) if len(V)==32 else V.encode()
    PkEnc = AES.new(K, AES.MODE_CBC, V).encrypt(pad(bytes.fromhex(Pk),16)).hex()
    L = len(PkEnc)//2
    hexlen = hex(L)[2:]
    if len(hexlen)%2 != 0: hexlen = '0'+hexlen
    total_pad = 12 - len(N) - len(hexlen)
    if total_pad < 0: total_pad = 0
    return bytes.fromhex(N + ('0'*total_pad) + hexlen + PkEnc)

# ==================== MOVIMIENTO ====================
async def build_movement_packet_2001(key_bytes, msg_key, player_state, x, y, z,
                                     tick, counter, move_state, account_uid,
                                     room_code, order_id=0, phase="game",
                                     send_option=None, yaw=None):
    """2001 cifrado con TEA-CBC y con el layout derivado del match_code.
    El frame completo (padding, cifrado, layout, CRC7) lo arma build_packet()."""
    ru, _ = await layouts_from_mask(room_code)
    if not ru:
        ru = [1, 3, 4]
    if send_option is None:
        send_option = MOVEMENT_SEND_OPTION
    body = bytearray()
    body += await uleb_encode(int(account_uid))
    body += await uleb_encode(int(player_state))
    body += await zigzag_encode_signed(int(x))
    body += await zigzag_encode_signed(int(y))
    body += await zigzag_encode_signed(int(z))
    body += b"\x00"
    body += await uleb_encode(int(move_state))
    body += b"\x00" * 7
    if yaw is None:
        body += b"\x93\xca\xd5\xf9\x0b"
    else:
        body += await uleb_encode(struct.unpack("<I", struct.pack("<f", float(yaw)))[0])
    body += b"\x8e\xfe\xfc\xf7\x0b"
    body += b"\xf4\xe0\xfe\xf7\x03"
    body += b"\x00\x00"
    body += await uleb_encode(int(tick))
    body += b"\x00\x00\x00"
    body += await uleb_encode(int(counter))
    return await build_packet(msg_key, ru, send_option, 2001,
                              order_id, 1, bytes(body), key_bytes, encrypted=True)
    body = bytes(body)
    k = key_bytes[0]
    v80 = ((k << 8) | k) & 0xFFFF
    h = bytearray()
    h.append(msg_key & 0xFF); h.append(0x00); h.append(0x00 ^ k)
    h += ((2001 ^ v80) & 0xFFFF).to_bytes(2, "little")
    h += ((len(body) ^ v80) & 0xFFFF).to_bytes(2, "little")
    h.append(0x00 ^ k)
    h[1] = (await crc7_buff(0, bytes(h[2:]) + body)) & 0x7F
    return bytes(h) + body

async def send_newbie_character_tcp(writer, account_id, key, iv):
    if not ENABLE_NEWBIE_CHARACTER:
        return False
    print_info("[PERSONAJE] Elegir personaje nuevo está apagado")
    return False

# ==================== CONTROL DEL MOVIMIENTO ====================
class MovementController:
    def __init__(self, account_id, account_region, key, iv,
                 tcp_writer=None, udp_sock=None, udp_server=None,
                 udp_key_bytes=None, match_code=None):
        self.account_id = int(account_id) if str(account_id).isdigit() else 0
        self.region = str(account_region).upper()
        self.key = key; self.iv = iv
        self.tcp_writer = tcp_writer
        self.udp_sock = udp_sock
        self.udp_server = udp_server
        self.udp_key = udp_key_bytes
        self.match_code = match_code
        self.origin_x = MOVEMENT_ORIGIN_X + random.uniform(-MOVEMENT_ORIGIN_JITTER, MOVEMENT_ORIGIN_JITTER)
        self.origin_y = MOVEMENT_ORIGIN_Y + random.uniform(-MOVEMENT_ORIGIN_JITTER, MOVEMENT_ORIGIN_JITTER)
        self.x = self.origin_x; self.y = self.origin_y; self.z = 0.0
        self.tick = random.randint(0, 0xFFFF)
        self.counter = random.randint(0, 0xFFFF)
        self.order_id = random.randint(0, 0xFFFF)
        self.msg_key = MOVEMENT_MSG_KEY
        self.angle = random.uniform(0, 6.28)
        self.analog_x = 0.0; self.analog_y = 0.0
        self.state = "walk"
        self.speed_mul = random.uniform(MOVEMENT_SPEED_MIN, MOVEMENT_SPEED_MAX)
        self._stop_evt = asyncio.Event()
        self._ready_evt = asyncio.Event()
        self._task = None
        self._last_decision = 0.0
        self._last_speed_change = 0.0
        self._last_ping_t = 0.0
        self._last_jump_t = 0.0
        self.last_server_addr = None
        self.send_option = MOVEMENT_SEND_OPTION
        self._opt_idx = 0
        self._sent_since_echo = 0
        self._echo_seen = False
        self._ping_warned = False
        self.yaw = 0.0

    def _pick_state(self) -> str:
        r = random.random(); c = MOVEMENT_STATE_IDLE_CHANCE
        if r < c: return "idle"
        c += MOVEMENT_STATE_WALK_CHANCE
        if r < c: return "walk"
        c += MOVEMENT_STATE_RUN_CHANCE
        if r < c: return "run"
        c += MOVEMENT_STATE_SPRINT_CHANCE
        if r < c: return "sprint"
        c += MOVEMENT_STATE_JUMP_CHANCE
        if r < c: return "jump"
        c += MOVEMENT_STATE_CROUCH_CHANCE
        if r < c: return "crouch"
        return "prone"

    def _update_circle_analog(self, dt):
        self.angle += (2.0 * math.pi / 6.0) * dt
        tx = 0.9 * math.cos(self.angle); ty = 0.9 * math.sin(self.angle)
        self.analog_x = max(-1.0, min(1.0, self.analog_x * 0.5 + tx * 0.5))
        self.analog_y = max(-1.0, min(1.0, self.analog_y * 0.5 + ty * 0.5))

    def _update_random_analog(self):
        ax, ay, _ = random.choice(ANALOG_DIRECTIONS[:-1])
        self.analog_x = ax * random.uniform(0.7, 1.0)
        self.analog_y = ay * random.uniform(0.7, 1.0)

    def _step_position(self, dt):
        base = STATE_SPEED.get(self.state, 0)
        speed = base * self.speed_mul
        if speed <= 0 or (self.analog_x == 0.0 and self.analog_y == 0.0): return
        mag = (self.analog_x ** 2 + self.analog_y ** 2) ** 0.5
        if mag <= 0: return
        nx = self.analog_x / mag
        ny = self.analog_y / mag
        self.yaw = math.atan2(ny, nx)
        self.x += nx * speed * dt; self.y += ny * speed * dt
        dx = self.x - self.origin_x; dy = self.y - self.origin_y
        dist = (dx * dx + dy * dy) ** 0.5
        if dist > MOVEMENT_RADIUS:
            ratio = MOVEMENT_RADIUS / dist
            self.x = self.origin_x + dx * ratio
            self.y = self.origin_y + dy * ratio

    def set_server_addr(self, addr):
        if addr:
            self.last_server_addr = addr

    def _rotate_send_option(self):
        self._opt_idx = (self._opt_idx + 1) % len(MOVEMENT_SEND_OPTIONS)
        self.send_option = MOVEMENT_SEND_OPTIONS[self._opt_idx]
        self._sent_since_echo = 0
        print_warning(f"[ACTIVIDAD] El servidor no confirma el movimiento; "
                      f"prueba sendOption={self.send_option} | cuenta {self.account_id}")

    def note_server_frame(self, cmd=None):
        self._sent_since_echo = 0
        if cmd in MOVEMENT_ECHO_CMDS:
            if not self._echo_seen:
                print_success(f"[ACTIVIDAD] El servidor confirmó el movimiento (cmd {cmd}) "
                              f"con sendOption={self.send_option} | cuenta {self.account_id}")
            self._echo_seen = True

    async def _send_udp(self):
        if not self.udp_sock or not self.udp_server or not self.udp_key:
            print_warning("[ACTIVIDAD] Sin socket, servidor o clave UDP"); return False
        try:
            loop = asyncio.get_running_loop()
            dest = self.last_server_addr or self.udp_server
            self.tick = (self.tick + 1) & 0xFFFF
            self.counter = (self.counter + 1) & 0xFFFF
            self.order_id = (self.order_id + 1) & 0xFFFF
            p_state = PLAYER_STATE_MAP.get(self.state, 1)
            m_state = MOVE_STATE_MAP.get(self.state, 1)
            pkt = await build_movement_packet_2001(
                self.udp_key, self.msg_key, p_state,
                int(self.x), int(self.y), int(self.z),
                self.tick, self.counter, m_state,
                self.account_id, self.match_code, self.order_id, phase="game",
                send_option=self.send_option,
                yaw=(self.yaw if MOVEMENT_DYNAMIC_HEADING else None))
            if DEBUG_MOVEMENT_HEX and self.counter <= 5:
                print_info(f"[ACTIVIDAD] 2001 {len(pkt)}B so={self.send_option} -> {pkt.hex()}")
            await loop.sock_sendto(self.udp_sock, pkt, dest)
            self._sent_since_echo += 1
            if not self._echo_seen and self._sent_since_echo >= MOVEMENT_CONFIRM_AFTER:
                self._rotate_send_option()
            return True
        except Exception as e:
            print_warning(f"[ACTIVIDAD] Envío falló: {e!r}")
            return False

    async def _send_ping(self):
        if not self.udp_sock or not self.udp_server or not self.udp_key: return
        try:
            loop = asyncio.get_running_loop()
            nr = (await layouts_from_mask(self.match_code or "134"))[1]
            ping_pkt = await build_packet(
                0x6D, nr, 0, 3, None, 0,
                struct.pack("<I", int(time.time()*1000) & 0xFFFFFFFF) + b"\x00\x00\x00",
                self.udp_key, encrypted=False)
            await loop.sock_sendto(self.udp_sock, ping_pkt,
                                   self.last_server_addr or self.udp_server)
        except Exception as e:
            if not self._ping_warned:
                self._ping_warned = True
                print_warning(f"[ACTIVIDAD] Ping falló: {e!r}")

    async def _do_jump(self):
        old = self.state
        self.state = "jump"
        try: await self._send_udp()
        finally: self.state = old

    def mark_ready(self):
        self._ready_evt.set()

    async def _loop(self):
        try:
            await asyncio.wait_for(self._ready_evt.wait(), timeout=ANTI_AFK_SPAWN_DELAY)
        except asyncio.TimeoutError:
            print_warning(f"[ACTIVIDAD] Sin confirmación de spawn | cuenta {self.account_id}")
        if self._stop_evt.is_set(): return
        await asyncio.sleep(MOVEMENT_START_DELAY)
        if self._stop_evt.is_set(): return
        print_premium(f"[ACTIVIDAD] Inicia | cuenta {self.account_id} | patrón {MOVEMENT_PATTERN}",
                      color=PX.MINT, icon=I["rocket"])
        interval = MOVEMENT_TICK_MS / 1000.0
        last_t = asyncio.get_event_loop().time()
        sent = 0; fail = 0
        while not self._stop_evt.is_set():
            now = asyncio.get_event_loop().time()
            dt = now - last_t; last_t = now
            if now - self._last_ping_t >= ANTI_AFK_PING_EVERY:
                self._last_ping_t = now; await self._send_ping()
            if now - self._last_jump_t >= ANTI_AFK_JUMP_EVERY:
                self._last_jump_t = now; await self._do_jump()
                print_info(f"[ACTIVIDAD] Salto | cuenta {self.account_id}")
            if now - self._last_decision >= ANTI_AFK_DECISION_SEC:
                self.state = self._pick_state()
                self._last_decision = now
                print_info(f"[ACTIVIDAD] Estado {self.state} | velocidad x{self.speed_mul:.2f}")
            if now - self._last_speed_change >= MOVEMENT_UPDATE_SPEED_EVERY:
                self.speed_mul = random.uniform(MOVEMENT_SPEED_MIN, MOVEMENT_SPEED_MAX)
                self._last_speed_change = now
            if self.state not in ("idle","prone"):
                if MOVEMENT_PATTERN == "circle": self._update_circle_analog(dt)
                elif MOVEMENT_PATTERN == "zigzag":
                    if int(now) % 2 == 0:
                        self.analog_x = 0.8 * (1 if int(now) % 4 < 2 else -1)
                        self.analog_y = 0.9
                else:
                    if now - self._last_decision < 0.1: self._update_random_analog()
            else:
                self.analog_x = 0.0; self.analog_y = 0.0
            self._step_position(dt)
            self.z += random.uniform(-0.2, 0.2); self.z = max(-2, min(2, self.z))
            ok = await self._send_udp()
            if ok: sent += 1; fail = 0
            else:
                fail += 1
                if fail % 30 == 0: print_warning(f"[ACTIVIDAD] Fallaron {fail} envíos seguidos")
            try: await asyncio.wait_for(self._stop_evt.wait(), timeout=interval)
            except asyncio.TimeoutError: pass
        if self._echo_seen:
            print_success(f"[ACTIVIDAD] Termina | {sent} enviados · "
                          f"el servidor SÍ aceptó el movimiento (so={self.send_option})")
        else:
            print_warning(f"[ACTIVIDAD] Termina | {sent} enviados · "
                          f"el servidor NO confirmó ningún movimiento")

    def start(self):
        if self._task and not self._task.done(): return
        self._stop_evt.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self._stop_evt.set()
        if self._task:
            try: await asyncio.wait_for(self._task, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()

# ==================== PAQUETES DE EQUIPO ====================
def create_team(key, iv, region="ID", game_version="1.132.9", mode=None):
    region = (str(region).upper() if region else "ID")
    modo_id, mapa_id = _modo_y_mapa(mode)
    mapa_blob = bytes([mapa_id]) if mapa_id else b""
    fields = {1: 1, 2: {2: mapa_blob, 3: modo_id, 4: 3, 5: "en",
            8: {1: "IDC3", 2: 123, 3: region}, 9: 1,
            10: bytes.fromhex("01090a0b1219202729"), 11: 2, 13: 1,
            14: {1: "08FBA33B4BABE2790205390333330000009700050092005F72697EB2134DCBB2467625142201040e38e848dc0e748c3f6aa04d81000000ff1113090dcacfa16d",
                2: 478, 3: "7e585d55", 4: "y[Z]", 6: 12, 7: "15686677735a7506101c",
                8: str(game_version), 9: 3, 10: 1, 11: "03626253513637754174"},
            19: 329, 21: bytes.fromhex("374f521955"),
            24: {1: 21}, 27: "a_6534489873065906362"}}
    return create_packet(create_proto(fields).hex(), "0515", key, iv)

def team_fresh(account_id, key, iv):
    return create_packet(create_proto({1: 72, 2: {1: int(account_id)}}).hex(), "0515", key, iv)

def invite_player_in_team(target_uid, key, iv, region="ID"):
    region = (str(region).upper() if region else "ID")
    return create_packet(create_proto({1: 2, 2: {1: int(target_uid), 2: region, 4: 1}}).hex(),
                         "0515", key, iv)

def accept_team_invite(target_uid, group_id, key, iv, region="ID", game_version="1.132.9"):
    region = (str(region).upper() if region else "ID")
    fields = {1: 4, 2: {1: int(target_uid), 3: int(target_uid),
        4: bytes.fromhex("0107090a0b120f19202729"), 8: 1,
        9: {1: "08FBA33B0522052002041B0222220007000C00010004000547E265AE1080779546762514110104076fa2e8770e748c3f6a68ed75000000ff08080500cacfa16d",
            2: 235, 3: {14: 80, 11: 86}, 4: "{Y\\R", 6: 13, 7: {2: 4},
            8: str(game_version), 9: 2, 10: 1, 11: "0362625351"},
        10: str(group_id), 11: {1: "IDC3", 2: 107, 3: region},
        13: "en", 16: "374f5219", 20: {1: 21}, 23: "a_6534489873065906362",
        24: "https://dl-sg-production.freefiremobile.com/", 27: {1: 2, 2: 4}}}
    return create_packet(create_proto(fields).hex(), "0515", key, iv)

def start_match_team(account_id, key, iv, region="ID"):
    region = (str(region).upper() if region else "ID")
    fields = {1: 9, 2: {1: int(account_id), 7: {1: "IDC3", 2: 410, 3: region}}}
    return create_packet(create_proto(fields).hex(), "0515", key, iv)

def ready_for_game(uid, key, iv):
    fields = {1: 15, 2: {1: uid, 2: 1}}
    return create_packet(create_proto(fields).hex(), "0519", key, iv)

# ==================== EXTRAER CLAVES ====================
async def _cs_generate_packet(proto_hex, prefix, key, iv):
    cipher = AES.new(key, AES.MODE_CBC, iv)
    encrypted = cipher.encrypt(pad(bytes.fromhex(proto_hex), 16)).hex()
    length = len(encrypted) // 2
    length_hex = hex(length)[2:]
    if len(length_hex) == 2: header = prefix + "000000"
    elif len(length_hex) == 3: header = prefix + "00000"
    elif len(length_hex) == 4: header = prefix + "0000"
    elif len(length_hex) == 5: header = prefix + "000"
    else: raise ValueError(f"[CS] Unexpected length hex: {length_hex}")
    return bytes.fromhex(header + length_hex + encrypted)

def _extract_key_iv(res_json):
    if "__RAW_HEX__" in res_json and "__OFFSET__" in res_json:
        try:
            raw = bytes.fromhex(res_json["__RAW_HEX__"])
            off = int(res_json["__OFFSET__"])
            rf = extract_raw_fields(raw[off:])
            for kf, vf in [(22,23),(24,25),(6,7)]:
                k = rf.get(kf); v = rf.get(vf)
                if isinstance(k,(bytes,bytearray)) and len(k)==16 and \
                   isinstance(v,(bytes,bytearray)) and len(v)==16:
                    return bytes(k), bytes(v)
        except Exception: pass
    found = {}
    for k, v in res_json.items():
        if str(k).startswith("__"): continue
        if not isinstance(v, dict): continue
        data = v.get("data")
        if data is None: continue
        raw = None
        if isinstance(data, (bytes,bytearray)) and len(data)==16: raw = bytes(data)
        elif isinstance(data, str) and len(data)==32:
            try:
                c = bytes.fromhex(data)
                if len(c)==16: raw = c
            except Exception: pass
        if raw and len(raw)==16:
            try: found[int(k)] = raw
            except Exception: pass
    if len(found) < 2: return None, None
    for kf, vf in [(22,23),(24,25),(6,7)]:
        if kf in found and vf in found: return found[kf], found[vf]
    sk = sorted(found.keys())
    return found[sk[0]], found[sk[1]]

async def aes_encrypt(payload, key, iv):
    return AES.new(key, AES.MODE_CBC, iv).encrypt(pad(payload, AES.block_size))

# ==================== VERSIÓN / INICIO DE SESIÓN ====================
def get_app_version():
    try: return play_scraper('com.dts.freefireth').get('version')
    except Exception: return "1.132.9"

async def version_config(region="ID"):
    app_version = get_app_version()
    lang = REGION_LANG.get(region.upper(), "en")
    url = (f"https://version.ggwhitehawk.com/live/ver.php?version={app_version}"
           f"&lang={lang}&device=android&channel=android&appstore=googleplay"
           f"&region={region.upper()}&whitelist_version=1.3.0&whitelist_sp_version=1.0.0")
    try:
        r = await client.get(url)
        j = r.json()
        server_url = j.get("server_url")
        remote_version = j.get("remote_version")
        latest_release_version = j.get("latest_release_version")
        gops = [u.strip() for u in j.get("gop_url","").split(";") if u.strip()]
        gop_1 = gops[0] if gops else "https://ffmconnect.ppmainecoonghj.com"
        if not server_url: return None
        return latest_release_version, remote_version, server_url, gop_1, app_version
    except Exception as e:
        print_error(f"[VERSIÓN] {e}"); return None

async def get_access_token(uid, password):
    url = "https://100067.connect.garena.com/oauth/guest/token/grant"
    hdrs = {"Host":"100067.connect.garena.com",
        "User-Agent":"Dalvik/2.1.0 (Linux; U; Android 12; SM-G998B)",
        "Content-Type":"application/x-www-form-urlencoded",
        "Accept-Encoding":"gzip, deflate, br","Connection":"close"}
    data = {"uid":str(uid),"password":password,"response_type":"token","client_type":"2",
        "client_secret":HEX_KEY,"client_id":"100067"}
    for _ in range(4):
        try:
            r = await client.post(url, headers=hdrs, data=data)
            if r.status_code == 200:
                j = r.json()
                oid = j.get("open_id"); at = j.get("access_token"); pf = j.get("platform",4)
                if oid and at: return oid, at, pf
        except Exception: pass
        await asyncio.sleep(0.7)
    return None

def generate_signature(payload_str):
    return hmac.new(API_KEY, payload_str.encode(), hashlib.sha256).hexdigest()

async def register_account(password, gop_url, app_version):
    connector = aiohttp.TCPConnector(resolver=aiohttp.ThreadedResolver())
    rp = {"app_id":100067,"client_type":2,"password":password,"source":2}
    payload = json.dumps(rp, separators=(',',':'))
    sig = generate_signature(payload)
    headers = {
        "User-Agent": f"GarenaMSDK/4.0.44(SM-E135F ;Android 14;en;GB;app {app_version} 2019118525;)",
        "Authorization": f"Signature {sig}",
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8"}
    try:
        async with aiohttp.ClientSession(connector=connector) as s:
            async with s.post(f"{gop_url}/api/v2/oauth/guest:register",
                              headers=headers, data=payload,
                              timeout=aiohttp.ClientTimeout(total=15)) as resp:
                data = json.loads(await resp.text())
                if data.get("code") == 0: return data["data"]["uid"]
    except Exception as e: print_error(f"[REGISTRO] {e}")
    return None

async def grant_token(uid, password, gop_url, app_version):
    connector = aiohttp.TCPConnector(resolver=aiohttp.ThreadedResolver())
    gp = {"client_id":100067,"client_secret":HEX_KEY,"client_type":2,
          "device_id":f"02-{uuid.uuid4()}","password":password,
          "response_type":"token","uid":int(uid)}
    payload = json.dumps(gp, separators=(',',':'))
    sig = generate_signature(payload)
    headers = {
        "User-Agent": f"GarenaMSDK/4.0.44(SM-E135F ;Android 14;en;GB;app {app_version} 2019118525;)",
        "Authorization": f"Signature {sig}",
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8"}
    try:
        async with aiohttp.ClientSession(connector=connector) as s:
            async with s.post(f"{gop_url}/api/v2/oauth/guest/token:grant",
                              headers=headers, data=payload,
                              timeout=aiohttp.ClientTimeout(total=15)) as resp:
                data = json.loads(await resp.text())
                if data.get("code") == 0: return data["data"]
    except Exception as e: print_error(f"[PERMISO] {e}")
    return None

# ==================== DATOS DE ENVÍO ====================
async def get_payload(access_token, open_id, platform, version, lang_code="en"):
    device_id = f"Google|{uuid.uuid4()}"
    major_login = {
        "3": str(datetime.now())[:-7], "4": "free fire", "5": 1, "7": f"{version}",
        "8": "Android OS 14 / API-34 (UP1A.231005.007/E135FXXSEEZE2)",
        "9": "Handheld", "11": "CarrierDataNetwork", "12": 1672, "13": 750, "14": "338",
        "15": "ARMv7 VFPv3 NEON | 2002 | 8", "16": 3702, "17": "Mali-G52",
        "18": "OpenGL ES 3.2 v1.r38p1-01bet0-mbs2v41_0.6d20ec041e51b2f2d25dfc265586ebe8",
        "19": device_id, "20": "104.28.197.151", "21": lang_code,
        "22": f"{open_id}", "23": f"{platform}", "24": "Handheld",
        "25": "samsung SM-E135F", "26": "ID", "29": f"{access_token}", "30": 1,
        "42": "Cellular", "57": "7428b253defc164018c604a1ebbfebdf",
        "60": 52037, "61": 5355, "62": 3723, "63": 3, "64": 5483, "65": 52037,
        "66": 5483, "67": 52037, "73": 2,
        "74": "/data/app/~~yACsV8QOk9OexgajWQP30A==/com.dts.freefireth-Bi_wPVrrhYM2nYncc29q7Q==/lib/arm",
        "76": 1,
        "77": "b8e0cd5e295eee42f5860d3c86e483dd|/data/app/~~yACsV8QOk9OexgajWQP30A==/com.dts.freefireth-Bi_wPVrrhYM2nYncc29q7Q==/base.apk",
        "78": 3, "79": 1, "81": "32", "83": "2019121229", "86": "OpenGLES2",
        "87": 8191, "88": int(platform), "92": 16091, "93": "android",
        "94": "KqsHT3Yeqo3RLRl8efNiL3aL/1SHwlSrtK0DwNAqdkNBQz70TeVy+icaIwuR3UK4b65Uf3IG5xBFEv0uu+jQZI+rOYCmNCsXjJT4QcZaYgoaaUGG",
        "95": 111107, "96": "{\"cur_rate\":null,\"support_etc2\":false}",
        "97": 1, "98": 1, "99": f"{platform}", "100": f"{platform}",
        "102": "4503454457550c0766", "104": 53792, "105": 1,
        "106": "https://dl-bs.ggpolarbear.com/live/ABHotUpdates/|https://core-bs.ggpolarbear.com/live/ABHotUpdates/|6b2078db9d22dd98f8e9386a39af8462",
        "107": "c8e41b7a93f02d56e1a94c7b8203f5d1",
    }
    get_login_data = dict(major_login)
    get_login_data["90"] = "Khulna"
    get_login_data["91"] = "D"
    get_login_data["99"] = "0"
    get_login_data["103"] = 1
    proto1 = create_proto(major_login).hex()
    proto2 = create_proto(get_login_data).hex()
    return bytes.fromhex(encrypt_aes(proto1)), bytes.fromhex(encrypt_aes(proto2))

async def major_login(payload, login_url, release_version):
    url = f"{login_url.rstrip('/')}/MajorLogin"
    req_headers = {"Accept": "*/*", "Authorization": "Bearer ",
        "Content-Type": "application/x-www-form-urlencoded",
        "ReleaseVersion": f"{release_version}", "User-Agent": "UnityPlayer/2018.4.12f1",
        "X-GA": "v1 1", "X-GA-SV": str(int(time.time())), "X-Unity-Version": "2018.4.12f1"}
    try:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False; ssl_context.verify_mode = ssl.CERT_NONE
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
            async with session.post(url, headers=req_headers, data=payload, ssl=ssl_context) as response:
                response_content = await response.read()
                print_info(f"[SESIÓN] Respuesta {response.status} ({len(response_content)} bytes)")
                if response.status != 200 or len(response_content) < 200: return None
                best = None; best_score = -1; best_off = 0
                for offset in [64, 0, 48, 32, 80, 16, 128, 8, 96, 60, 56, 40, 24, 20, 12, 4]:
                    if offset >= len(response_content): continue
                    cb = response_content[offset:]
                    cand = None
                    try: cand = decode_protobuf_dict(cb)
                    except Exception: cand = None
                    if not cand:
                        try:
                            c2 = decode_protobuf_2(cb)
                            if c2: cand = {str(k): {"data": v} for k, v in c2.items()}
                        except Exception: cand = None
                    if not cand: continue
                    keys = set(cand.keys())
                    has_jwt = ("8" in keys) or (8 in keys)
                    has_url = ("10" in keys) or (10 in keys)
                    score = len(cand) + (100 if has_jwt else 0) + (50 if has_url else 0)
                    if score > best_score:
                        best = cand; best_score = score; best_off = offset
                    if has_jwt and has_url: break
                if not best: return None
                if ("8" not in best) and (8 not in best): return None
                best["__RAW_HEX__"] = response_content.hex()
                best["__OFFSET__"] = best_off
                return best
    except Exception as e:
        print_error(f"[SESIÓN] {e}"); return None

async def get_login_data(payload, jwt_token, server_url, release_version):
    url = f"{server_url.rstrip('/')}/GetLoginData"
    hdrs = {"Accept":"*/*","Authorization":f"Bearer {jwt_token}",
        "Content-Type":"application/x-www-form-urlencoded",
        "ReleaseVersion":f"{release_version}", "User-Agent":"UnityPlayer/2018.4.12f1",
        "X-GA":"v1 1","X-GA-SV":str(int(time.time())),"X-Unity-Version":"2018.4.12f1"}
    try:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.post(url, headers=hdrs, data=payload, ssl=ssl_ctx) as r:
                if r.status != 200: return None
                content = await r.read()
                for off in [0,64,48,32,80,16,128,8,96]:
                    if off >= len(content): continue
                    try:
                        c = decode_protobuf_dict(content[off:])
                        if c and len(c) >= 3: return c
                    except Exception: pass
                for off in [0,64,48,32,80]:
                    if off >= len(content): continue
                    c = decode_protobuf_2(content[off:])
                    if c and len(c) >= 3:
                        return {str(k):{"data":v} for k,v in c.items()}
        return None
    except Exception: return None

async def get_player_personal_show(target_uid, jwt_token, server_url, release_version):
    url = f"{server_url}/GetPlayerPersonalShow"
    payload = bytes.fromhex(encrypt_aes(create_proto({"1":int(target_uid)}).hex()))
    hdrs = {"authorization":f"Bearer {jwt_token}",
        "host":server_url.replace("https://","").split("/")[0],
        "x-ga":"v1 1","content-type":"application/x-www-form-urlencoded",
        "releaseversion":f"{release_version}",
        "user-agent":"UnityPlayer/2022.3.47f1","accept":"*/*",
        "x-unity-version":"2022.3.47f1"}
    try:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.post(url, headers=hdrs, data=payload, ssl=ssl_ctx) as r:
                if r.status != 200: return None
                return decode_protobuf_2(await r.read())
    except Exception: return None

# ==================== CLAN ====================
def _get_region_from_jwt(jwt_token):
    try:
        p = jwt_token.split('.')[1]
        p += '=' * (-len(p) % 4)
        d = json.loads(base64.urlsafe_b64decode(p))
        return (d.get('lock_region') or d.get('noti_region') or 'BD').upper()
    except Exception: return "ID"

def _get_region_url(region):
    region = region.upper()
    if region == "IND": return "https://client.ind.freefiremobile.com"
    if region in ["BR","US","NA"]: return "https://client.us.freefiremobile.com"
    return "https://clientbp.ggpolarbear.com"

def _create_clan_payload(clan_id):
    if not _CLAN_PB_AVAILABLE: return None
    try:
        msg = reqClan_pb2.MyMessage()
        msg.field_1 = int(clan_id)
        raw = msg.SerializeToString()
        return AES.new(AES_KEY, AES.MODE_CBC, AES_IV).encrypt(pad(raw, AES.block_size))
    except Exception as e:
        print_error(f"[CLAN] {e}"); return None

async def join_clan(jwt_token, clan_id):
    if not _CLAN_PB_AVAILABLE: return False
    try:
        region = _get_region_from_jwt(jwt_token)
        base_url = _get_region_url(region)
        url = base_url.rstrip("/") + "/RequestJoinClan"
        host = base_url.replace("https://","")
        payload = _create_clan_payload(clan_id)
        if not payload: return False
        hdrs = {"Authorization":f"Bearer {jwt_token}",
            "X-Unity-Version":"2018.4.11f1","X-GA":"v1 1","ReleaseVersion":"OB55",
            "Content-Type":"application/octet-stream","Host":host,
            "Connection":"Keep-Alive","Accept-Encoding":"gzip"}
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
            async with s.post(url, headers=hdrs, data=payload, ssl=ssl_ctx) as r:
                if r.status == 200:
                    print_success(f"[CLAN] Pidió entrar al clan {clan_id}"); return True
                print_warning(f"[CLAN] Respuesta del clan: {r.status}"); return False
    except Exception as e:
        print_error(f"[CLAN] {e}"); return False

# ==================== SALIR DEL CLAN / ROTACIÓN ====================
# El juego no nos dio el comando de "salir del clan", así que se prueban los nombres
# más probables. El primero que responda bien se recuerda y los demás bots ya usan ese.
CLAN_SALIDA_RUTAS = ["/LeaveClan", "/RequestLeaveClan", "/QuitClan", "/RequestQuitClan",
                     "/ExitClan", "/RequestExitClan", "/ClanLeave", "/LeaveGuild",
                     "/RequestLeaveGuild", "/GuildLeave", "/ClanQuit"]
_clan_salida_ok = {"ruta": None, "imposible": False}

async def leave_clan(jwt_token, clan_id=None):
    """Saca al bot del clan en el que esté. Devuelve True si el juego aceptó."""
    try:
        region = _get_region_from_jwt(jwt_token)
        base_url = _get_region_url(region)
        host = base_url.replace("https://", "")
        # Se prueba primero MANDANDO el id del clan actual (así lo pide el único sitio
        # donde se ha visto funcionar esto) y, si no, con el cuerpo vacío.
        cuerpos = []
        if clan_id:
            pl = _create_clan_payload(clan_id)
            if pl: cuerpos.append(pl)
        cuerpos.append(b"")
        hdrs = {"Authorization": f"Bearer {jwt_token}",
                "X-Unity-Version": "2018.4.11f1", "X-GA": "v1 1", "ReleaseVersion": "OB55",
                "Content-Type": "application/octet-stream", "Host": host,
                "Connection": "Keep-Alive", "Accept-Encoding": "gzip"}
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
        rutas = [_clan_salida_ok["ruta"]] if _clan_salida_ok["ruta"] else list(CLAN_SALIDA_RUTAS)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as ses:
            for ruta in rutas:
                url = base_url.rstrip("/") + ruta
                for payload in cuerpos:
                    try:
                        async with ses.post(url, headers=hdrs, data=payload, ssl=ssl_ctx) as r:
                            if r.status == 200:
                                if _clan_salida_ok["ruta"] != ruta:
                                    _clan_salida_ok["ruta"] = ruta
                                    print_success(f"[CLAN] El comando para salir del clan es {ruta}")
                                print_success("[CLAN] Salió del clan")
                                return True
                    except Exception:
                        continue
        if not _clan_salida_ok["ruta"] and not _clan_salida_ok["imposible"]:
            _clan_salida_ok["imposible"] = True
            print_warning("[CLAN] No encontré el comando para salir del clan. "
                          "Tendrás que sacarlos tú desde el juego (Administrar miembros).")
        return False
    except Exception as e:
        print_error(f"[CLAN] Error al salir del clan: {e}")
        return False

ROTACION_FILE = "clan_rotacion.json"
ROTACION_DEF = {"activo": False, "clan_id": "", "clan_actual": "", "salida": "", "entrada": "",
                "huso": -5, "hecho_salida": False, "hecho_entrada": False,
                "ultimo": "", "repetir_dias": 0}

def rotacion_cargar():
    cfg = dict(ROTACION_DEF)
    try:
        if os.path.exists(ROTACION_FILE):
            with open(ROTACION_FILE, "r", encoding="utf-8") as f:
                cfg.update(json.load(f) or {})
    except Exception as e:
        print_warning(f"[CLAN] No se pudo leer {ROTACION_FILE}: {e}")
    return cfg

def rotacion_guardar(cfg):
    try:
        tmp = ROTACION_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, ROTACION_FILE)
        return True
    except Exception as e:
        print_error(f"[CLAN] No se pudo guardar {ROTACION_FILE}: {e}")
        return False

def _rot_ahora(cfg):
    """La hora de TU zona (por defecto Ecuador, -5)."""
    from datetime import timedelta, timezone
    try: h = float(cfg.get("huso", -5))
    except Exception: h = -5.0
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=h)

def _rot_fecha(txt):
    if not txt: return None
    try:
        return datetime.strptime(str(txt).strip().replace("T", " ")[:16], "%Y-%m-%d %H:%M")
    except Exception:
        return None

def _rot_texto(dt):
    return dt.strftime("%Y-%m-%dT%H:%M") if dt else ""

async def _rotacion_para_todos(accion, clan_id=None, origen=None):
    """Saca o mete bots de a poco.
    - origen: si se da, SOLO los bots que están guardados en ese clan (los demás grupos
      de escuadras no se tocan). Sin origen, todos los bots conectados.
    - Al salir, clan_id es el clan en el que están; al entrar, el clan nuevo.
    Cuando entran al clan nuevo, se les cambia el clan en accounts.json para que el panel
    los muestre en su grupo nuevo."""
    origen = "".join(ch for ch in str(origen or "") if ch.isdigit())
    del_grupo = None
    if origen:
        del_grupo = {u for u, c in _clan_de_cuentas().items() if c == origen}
    cuentas = []
    vistos = set()
    for uid, ad in list(bot_state.account_credentials.items()):
        try:
            aid = str(ad.get("account_id") or uid)
            auth = str(ad.get("auth_uid") or bot_state.game_to_auth_id.get(aid, aid))
            if aid in vistos or not ad.get("token"):
                continue
            if del_grupo is not None and auth not in del_grupo and aid not in del_grupo:
                continue
            vistos.add(aid); cuentas.append((aid, auth, ad))
        except Exception:
            continue
    if not cuentas:
        txt = f" del clan {origen}" if origen else ""
        print_warning(f"[CLAN] No hay bots conectados{txt} para el cambio de clan")
        return 0, 0
    bien = 0
    movidos = []
    print_rule(f"CLAN · {'Saliendo del clan' if accion == 'salir' else f'Entrando al clan {clan_id}'} "
               f"· {len(cuentas)} bot(s)", color=PX.GOLD)
    for aid, auth, ad in cuentas:
        try:
            if accion == "salir":
                ok = await leave_clan(ad["token"], clan_id)
            else:
                ok = await join_clan(ad["token"], clan_id)
            if ok:
                bien += 1
                movidos.append(auth)
        except Exception as e:
            print_warning(f"[CLAN] {aid}: {e}")
        # de a poco, para no hacerlo todo de golpe
        await asyncio.sleep(random.uniform(1.5, 3.0))
    if accion == "entrar" and clan_id and movidos:
        try:
            async with _cuentas_lock:
                lista = _leer_cuentas()
                cambio = False
                for a in lista:
                    if str(a.get("uid")) in movidos and str(a.get("clan_id") or "") != str(clan_id):
                        a["clan_id"] = str(clan_id); cambio = True
                if cambio:
                    _guardar_cuentas(lista)
                    _clan_cache["mtime"] = None
        except Exception as e:
            print_warning(f"[CLAN] No se pudo anotar el clan nuevo en accounts.json: {e}")
    print_info(f"[CLAN] Listo: {bien} de {len(cuentas)} bot(s)")
    return bien, len(cuentas)

async def _rotacion_loop():
    """Vigila el reloj y hace el cambio de clan a la hora configurada."""
    from datetime import timedelta
    await asyncio.sleep(20)
    while True:
        try:
            cfg = rotacion_cargar()
            if cfg.get("activo"):
                ahora = _rot_ahora(cfg)
                f_sal = _rot_fecha(cfg.get("salida"))
                f_ent = _rot_fecha(cfg.get("entrada"))
                cambio = False
                if f_sal and not cfg.get("hecho_salida") and ahora >= f_sal:
                    cfg["hecho_salida"] = True
                    cfg["ultimo"] = f"Salida {ahora.strftime('%d/%m %H:%M')}"
                    rotacion_guardar(cfg); cambio = True
                    _act = str(cfg.get("clan_actual") or "").strip() or None
                    await _rotacion_para_todos("salir", _act, origen=_act)
                    cfg = rotacion_cargar()
                if (f_ent and not cfg.get("hecho_entrada") and ahora >= f_ent
                        and str(cfg.get("clan_id") or "").strip()):
                    cfg["hecho_entrada"] = True
                    cfg["ultimo"] = f"Entrada {ahora.strftime('%d/%m %H:%M')}"
                    rotacion_guardar(cfg); cambio = True
                    nuevo_id = str(cfg["clan_id"]).strip()
                    _act = str(cfg.get("clan_actual") or "").strip() or None
                    await _rotacion_para_todos("entrar", nuevo_id, origen=_act)
                    cfg = rotacion_cargar()
                    cfg["clan_actual"] = nuevo_id
                    rotacion_guardar(cfg)
                # ¿Se repite cada tantos días? Se corren las fechas y vuelve a empezar.
                rep = int(cfg.get("repetir_dias") or 0)
                if cambio and rep > 0 and cfg.get("hecho_salida") and cfg.get("hecho_entrada"):
                    if f_sal: cfg["salida"] = _rot_texto(f_sal + timedelta(days=rep))
                    if f_ent: cfg["entrada"] = _rot_texto(f_ent + timedelta(days=rep))
                    cfg["hecho_salida"] = False; cfg["hecho_entrada"] = False
                    rotacion_guardar(cfg)
                    print_info(f"[CLAN] Próximo cambio programado en {rep} día(s)")
        except Exception as e:
            print_warning(f"[CLAN] Vigilancia del clan: {e}")
        await asyncio.sleep(30)

# ==================== TCP ====================
async def build_tcp_startup_packet(account_id, token, server_time, key, iv, region="ID", typ='OnLine'):
    uid_hex = f"{int(account_id):016x}"
    ts_hex = f"{int(server_time):08x}"
    enc = (await aes_encrypt(token.encode(), key, iv)).hex()
    enc_len = f"{len(enc)//2:08x}"
    reg = str(region).upper() if region else "ID"
    if typ == 'OnLine':
        pfx = '7219' if reg == 'BD' else ('7214' if reg == 'IND' else '7215')
        return f"{pfx}{uid_hex}{ts_hex}00000000{enc_len}{enc}"
    pfx = '8119' if reg == 'BD' else ('8114' if reg == 'IND' else '8115')
    return f"{pfx}{uid_hex}{ts_hex}{enc_len}{enc}"

async def send_keep_alive(region="ID"):
    reg = str(region).upper() if region else "ID"
    return bytes.fromhex("0219" if reg == "ID" else ("0214" if reg == "IND" else "0215"))

async def start_game_battle_royale(region, client_version, writer, key, iv, mode=None):
    packet = bytes.fromhex("0314000001e0a8c1becfcdd1a311df1b23e218f8b6ae1df958f76dfeb6bfd0399d153d1f9687174c189de3900d11f3eb8fd92cd831c482b06adec14632935703a0423b76051274d67f1381e5794cc6256079d1514ad9f9fa864733257d8e5910e9ba2f048dbe5008ba23d7e4db609ceb46ab823a50a15d0692d44c73d1f6c8e9ee33462952f2685ef8b32faea409a9b61ea091f3a36a727773dbb8316c01dfa6512dbe5b3a3ce6c8310783386c9c70c8fe143f6bc39854fdd1fffd157e52ef006a9e1e944b252a0072154aa34a45b7a5f080d7043eaf0ec6dd884b62b906781cdecca9d49f50f521c4a57dcefc4e5c274f242dcad6489dae6795c2173803fb1d343f64d47699164508e95709a43f018efca4eab791ff4010aab17d1926f7d5e11983249879940d90d5f257ad66dc0e193716addb278510de0afa48825d24ec20724382d731a2f2258ace8a4e614bfb620dc90ee9c3a87e5deaed1d44efdb561e320bc9faab91aea632d060f4ffa268067ab588edd6342c086059accb30d036b3cf766858f54b434d446935912e0e9c21b7e22ace9f17852366bd2390988f82545239e54baafcfd7bcd75d8a69a327019f8b608d80a49cbb6a65b31eec3fcab74afee3da4a9d59e367edd3f32d8eb0b8b516bcfbc1e104bd8c8bda5b76f8e5190ec1898d004dc")
    _mid, _mmap = _modo_y_mapa(mode or GAME_MODE)
    packet = _start_match_con_modo(packet.hex(), _mid, _mmap)
    try:
        proto = thunderFF_pb2.StartMatch()
        proto.ParseFromString(packet)
        if hasattr(proto.main, 'region_list') and len(proto.main.region_list) > 0:
            proto.main.region_list[0].region = region
            if len(proto.main.region_list) > 1:
                proto.main.region_list[1].region = region
        if hasattr(proto.main, 'client_version'):
            proto.main.client_version.remote_version = client_version
        p = proto.SerializeToString()
    except Exception: p = packet
    raw_proto_hex = p.hex()
    reg = str(region).upper() if region else "BD"
    pkt_prefix = '0319' if reg == 'BD' else ('0314' if reg == 'IND' else '0315')
    packet_bytes = bytes.fromhex(raw_proto_hex)
    encrypted_packet = (await aes_encrypt(packet_bytes, key, iv)).hex()
    packet_length = len(encrypted_packet) // 2
    hex_length = f"{packet_length:08x}"
    writer.write(bytes.fromhex(pkt_prefix + hex_length + encrypted_packet))
    await writer.drain()
    print_premium(f"[PARTIDA] Buscando partida ({packet_length} B)", color=PX.AMBER, icon=I["target"])

# ==================== AYUDAS UDP ====================
# El cifrado TEA de las partidas es lo que más CPU gastaba. Antes cada bloque de 8 bytes
# pasaba por una función "async" aparte (muy lenta en Python) y además se descifraba TODO
# lo que manda el servidor durante la partida (posiciones, disparos, objetos...), aunque
# el bot no usa nada de eso. Ahora el cifrado va directo (varias veces más rápido) y solo
# se descifran los avisos que el bot sí necesita leer (ver decode_packet).
async def uleb_async(n): return await uleb_encode(n)

_M32 = 0xFFFFFFFF
_TEA_SUMAS_CIF = tuple((_DELTA * (r + 1)) & _M32 for r in range(_ROUNDS))
_TEA_SUMAS_DES = tuple(reversed(_TEA_SUMAS_CIF))

def tea_cbc_encrypt_sync(padded, key_bytes):
    k0, k1, k2, k3 = struct.unpack_from("<4I", key_bytes, 0)
    n = len(padded) >> 2
    if n == 0: return b""
    pal = struct.unpack("<%dI" % n, padded)
    out = [0] * n
    M = _M32; sumas = _TEA_SUMAS_CIF
    pc0 = pc1 = 0   # bloque cifrado anterior
    pi0 = pi1 = 0   # bloque mezclado anterior
    for i in range(0, n, 2):
        x0 = pal[i] ^ pc0; x1 = pal[i + 1] ^ pc1
        v0 = x0; v1 = x1
        for s in sumas:
            # (las sumas pasan de 32 bits, pero eso no cambia los 32 bits de abajo: se recorta al final)
            v0 = (v0 + (((v1 << 4) + k0) ^ (v1 + s) ^ ((v1 >> 5) + k1))) & M
            v1 = (v1 + (((v0 << 4) + k2) ^ (v0 + s) ^ ((v0 >> 5) + k3))) & M
        o0 = v0 ^ pi0; o1 = v1 ^ pi1
        out[i] = o0; out[i + 1] = o1
        pc0 = o0; pc1 = o1; pi0 = x0; pi1 = x1
    return struct.pack("<%dI" % n, *out)

def tea_cbc_decrypt_sync(body, key_bytes):
    k0, k1, k2, k3 = struct.unpack_from("<4I", key_bytes, 0)
    n = len(body) >> 2
    if n == 0: return b""
    pal = struct.unpack("<%dI" % n, body)
    out = [0] * n
    M = _M32; sumas = _TEA_SUMAS_DES
    pi0 = pi1 = 0   # bloque descifrado anterior
    pc0 = pc1 = 0   # bloque cifrado anterior
    for i in range(0, n, 2):
        c0 = pal[i]; c1 = pal[i + 1]
        v0 = c0 ^ pi0; v1 = c1 ^ pi1
        for s in sumas:
            v1 = (v1 - (((v0 << 4) + k2) ^ (v0 + s) ^ ((v0 >> 5) + k3))) & M
            v0 = (v0 - (((v1 << 4) + k0) ^ (v1 + s) ^ ((v1 >> 5) + k1))) & M
        out[i] = v0 ^ pc0; out[i + 1] = v1 ^ pc1
        pi0 = v0; pi1 = v1; pc0 = c0; pc1 = c1
    return struct.pack("<%dI" % n, *out)

async def tea_cbc_encrypt(padded, key_bytes):
    return tea_cbc_encrypt_sync(padded, key_bytes)

async def tea_cbc_decrypt(body, key_bytes):
    return tea_cbc_decrypt_sync(body, key_bytes)

def _rellenar(content):
    pad_len = (8 - (len(content) + 10) % 8) % 8
    return bytes([pad_len,0,0]) + b"\x00"*pad_len + content + b"\x00"*7

async def build_padded(content):
    return _rellenar(content)

async def encode_header(layout, so, cmd, oid, flags, length, k, v80):
    out = bytearray()
    for code in layout:
        val = {0:so,1:cmd,2:oid,3:flags,4:length}[code]
        if _FIELD_SIZES[code] == 1: out.append((val & 0xFF) ^ k)
        else:
            v = ((val & 0xFFFF) ^ v80) & 0xFFFF
            out.append(v & 0xFF); out.append((v >> 8) & 0xFF)
    return bytes(out)

def _crc7(buf, c=0):
    t = CRC7_TABLE; c &= 0x7F
    for b in buf: c = t[((c << 1) ^ b) & 0xFF] & 0x7F
    return c

async def crc7_buff(crc, buf):
    return _crc7(buf, crc)

async def sv_frame(msg_key, layout, so, cmd, oid, flags, content, key, encrypted=True):
    k = key[0]; v80 = ((k<<8)|k) & 0xFFFF
    body = await tea_cbc_encrypt(await build_padded(content), key) if encrypted else content
    hdr = bytearray([msg_key,0]) + await encode_header(layout, so, cmd, oid, flags, len(body), k, v80)
    pkt = bytearray(hdr + body)
    pkt[1] = await crc7_buff(0, bytes(pkt[2:])) & 0x7F
    return bytes(pkt)

async def build_match_startup_packets(token, udp_key, match_code, account_id, block_val,
                                      server_ip="", region="ID", client_version="1.132.9",
                                      client_version_code="2019121229",
                                      access_token="", mode_id=None, map_id=None):
    # Si no se los pasan, se toman del modo de juego general (antes esto usaba una variable
    # que no existe aquí y el programa ni arrancaba).
    if mode_id is None:
        mode_id = _modo_y_mapa(GAME_MODE)[0]
    if map_id is None:
        map_id = _modo_y_mapa(GAME_MODE)[1] or 0
    token = token.strip()
    udp_key = bytes.fromhex(udp_key)
    match_code = [int(ch) for ch in str(match_code).strip()]
    thunder_jwt = token[:660] if len(token) > 660 else token
    sharma_jwt = token[660:] if len(token) > 660 else ""
    eth = thunder_jwt.encode() if isinstance(thunder_jwt, str) else thunder_jwt
    esh = sharma_jwt.encode() if isinstance(sharma_jwt, str) else sharma_jwt
    garena420 = await has_ssan_zig(len(eth)) + eth
    reg = str(region).upper() if region else "ID"
    csoversea_block = bytes.fromhex(
        "ca0163736f7665727365612e7374726f6e67686f6c642e66726565666972656d6f62696c652e636f6d"
        "3b302e302e302e303b33342e3132362e37362e34353b33342e38372e3137372e31343b33342e38372e"
        "3137302e3233303b33352e3138352e3138332e35370000000000000100000000000000000000000001"
        "00000800000100000000000100a8a2d7bebd8d8bdf110200")
    mid = bytes.fromhex('0000000001000102030101') + await has_ssan_zig(len(reg)) + reg.encode()
    mid += bytes.fromhex('0001030003000004')
    mid += await has_ssan_zig(len(client_version)) + client_version.encode()
    mid += await has_ssan_zig(len(client_version_code)) + client_version_code.encode()
    mid += csoversea_block
    clean_ip = server_ip.split(':')[0] if server_ip else "0.0.0.0"
    mid += await has_ssan_zig(len(clean_ip)) + clean_ip.encode()
    clean_acc_tok = access_token.strip() if access_token else ""
    if clean_acc_tok: mid += await has_ssan_zig(len(clean_acc_tok)) + clean_acc_tok.encode()
    mid += await has_ssan_zig(len(esh)) + esh
    tg = (await uleb_encode(int(account_id)) + await uleb_encode(int(block_val)) +
          await uleb_encode(1) + await uleb_encode(int(mode_id)) +
          await uleb_encode(int(block_val)) + await uleb_encode(int(map_id)) + mid)
    process = await sv_frame(0x5E, match_code, 2, 447, 0, 1, garena420, udp_key)
    loading = await sv_frame(0x5A, match_code, 2, 448, 1, 1, tg, udp_key)
    return process.hex(), loading.hex()

async def build_hello_packet(text, key, layout):
    data = text.encode("utf-8")
    if len(data) > 25: raise ValueError("too long")
    content = b"\x10\x00\x00\x00" + data + b"\x00" * (29 - 4 - len(data))
    k = key[0]; v80 = ((k<<8)|k) & 0xFFFF
    layout = [int(c) for c in str(layout).strip()] if isinstance(layout, str) else list(layout)
    padded = await build_padded(content)
    enc_body = await tea_cbc_encrypt(padded, key)
    hbytes = await encode_header(layout, 1, 1, 0, 1, len(enc_body), k, v80)
    pkt = bytearray([0x63, 0x00]) + hbytes + enc_body
    pkt[1] = await crc7_buff(0, pkt[2:]) & 0x7F
    return bytes(pkt).hex()

async def classify(frame):
    cmd = frame["cmd"]
    msg_name = MESSAGE_ID_TO_NAME.get(cmd, f"UNKNOWN_{cmd}")
    if msg_name == "UDP_HELLO": return "HELLO"
    if msg_name == "UDP_ACK": return "ACK"
    if msg_name == "UDP_PING": return "PING"
    if msg_name == "RUDP_JOIN_MATCH": return "JOIN_MATCH"
    if msg_name.startswith("RUDP_"): return msg_name
    if msg_name.startswith("UDP_"): return msg_name
    return "DATA"

def build_packet_sync(msg_key, layout, so, cmd, oid, flags, content, key, encrypted=True):
    k = key[0]; v80 = ((k<<8)|k) & 0xFFFF
    body = tea_cbc_encrypt_sync(_rellenar(content), key) if encrypted else content
    hdr = bytearray([msg_key, 0])
    for code in layout:
        val = {0:so,1:cmd,2:oid,3:flags,4:len(body)}[code]
        if _FIELD_SIZES[code] == 1: hdr.append((val & 0xFF) ^ k)
        else:
            v = ((val & 0xFFFF) ^ v80) & 0xFFFF
            hdr.append(v & 0xFF); hdr.append((v >> 8) & 0xFF)
    pkt = bytearray(hdr + body)
    pkt[1] = _crc7(pkt[2:]) & 0x7F
    return bytes(pkt)

async def build_packet(msg_key, layout, so, cmd, oid, flags, content, key, encrypted=True):
    return build_packet_sync(msg_key, layout, so, cmd, oid, flags, content, key, encrypted)

_LAYOUTS_GUARDADOS = {}

def _layouts_de(mask):
    """(RUDP, nonRUDP) como tuplas; se calcula una vez por código de partida."""
    clave = mask if isinstance(mask, (str, int)) else tuple(mask)
    r = _LAYOUTS_GUARDADOS.get(clave)
    if r is None:
        if isinstance(mask, (list, tuple)):
            ru = tuple(int(c) for c in mask)
        else:
            ru = tuple(int(c) for c in str(mask).strip() if c.isdigit())
        r = (ru, tuple(c for c in ru if c != 2))
        if len(_LAYOUTS_GUARDADOS) > 512: _LAYOUTS_GUARDADOS.clear()
        _LAYOUTS_GUARDADOS[clave] = r
    return r

async def layouts_from_mask(mask):
    ru, nr = _layouts_de(mask)
    return list(ru), list(nr)

async def reply_for(frame, key, mask, ack_key=0x68, ping_key=0x6D, hello_key=0x5B, ack_style="short"):
    ru, nr = await layouts_from_mask(mask)
    typ = await classify(frame)
    if typ == "HELLO":
        if ack_style == "echo":
            content = frame["content"] if frame["content"] else b"\x10\x00\x00\x00"
            return typ, await build_packet(hello_key, nr, 1, 1, None, 1, content, key)
        return typ, await build_packet(ack_key, nr, 0, 2, None, 1, b"\x01\x00", key)
    if typ == "ACK":
        return typ, await build_packet(ack_key, nr, 0, 2, None, 1, frame["content"] or b"\x01\x00", key)
    if typ == "PING":
        c = frame["content"]
        counter = c[:4] if len(c) >= 4 else c
        return typ, await build_packet(ping_key, nr, 0, 3, None, 0, counter + b"\x00\x00\x00", key, encrypted=False)
    if typ == "JOIN_MATCH":
        return typ, await build_packet(ack_key, nr, 0, 2, None, 1, b"\x02\x00", key)
    return typ, None

async def keepalive_ping(sock, ip, port, key_bytes, mask, stop_event):
    nr = (await layouts_from_mask(mask))[1]
    ping_keys = [0x66, 0x6D, 0x69, 0x6C, 0x6B, 0x6E, 0x6F, 0x70]
    loop = asyncio.get_event_loop(); i = 0
    while not stop_event.is_set():
        pk = ping_keys[i % len(ping_keys)]
        counter = int(time.time() * 1000) & 0xFFFFFFFF
        pkt = await build_packet(pk, nr, 0, 3, None, 0,
                                 struct.pack("<I", counter) + b"\x00\x00\x00",
                                 key_bytes, encrypted=False)
        try: await loop.sock_sendto(sock, pkt, (ip, port))
        except Exception: pass
        i += 1
        try: await asyncio.wait_for(stop_event.wait(), timeout=3.0)
        except asyncio.TimeoutError: pass

def _leer_cabecera(buf, layout, k, v80):
    off = 2; out = {}; n = len(buf)
    for code in layout:
        size = _FIELD_SIZES[code]
        if off + size > n: return None
        out[_FIELD_NAMES[code]] = (buf[off] ^ k) if size == 1 else \
            ((buf[off] | (buf[off+1] << 8)) ^ v80) & 0xFFFF
        off += size
    out["headerLen"] = off
    return out

def _quitar_relleno(padded):
    if not padded or len(padded) < 8: return None
    if padded[-7:] != b"\x00\x00\x00\x00\x00\x00\x00": return None
    pad_len = padded[0] & 0x07
    s = 3 + pad_len; e = len(padded) - 7
    return padded[s:e] if s < e else b""

async def try_header(buf, layout, k, v80):
    return _leer_cabecera(buf, layout, k, v80)

async def oicq_unpad(padded):
    return _quitar_relleno(padded)

_TODOS_LOS_LAYOUTS = tuple(
    [("RUDP", p) for p in itertools.permutations((0, 1, 2, 3, 4))] +
    [("nonRUDP", p) for p in itertools.permutations((0, 1, 3, 4))])

# Avisos del servidor que el bot SÍ lee por dentro durante la partida: saludo, confirmación,
# ping, despedida, entrada a la partida, jugador que entra, fin de partida y muerte.
# Todo lo demás (posiciones, disparos, objetos...) solo se mira por fuera: la cabecera ya
# dice qué tipo de aviso es, y descifrarlo entero era lo que se comía el CPU.
_CMDS_LEER_COMPLETO = frozenset((1, 2, 3, 4, 5, 100, 101, 103, 107))

def decode_packet_sync(packet, key, mask=None, ligero=False):
    if isinstance(packet, bytes): data = packet
    elif isinstance(packet, str): data = bytes.fromhex(packet)
    else: data = bytes(packet)
    if len(data) < 8: return None
    k = key[0]; v80 = ((k<<8)|k) & 0xFFFF
    if mask:
        ru, nr = _layouts_de(mask)
        layouts = (("RUDP", ru), ("nonRUDP", nr))
    else:
        layouts = _TODOS_LOS_LAYOUTS
    total = len(data)
    vistos = []
    for kind, layout in layouts:
        f = _leer_cabecera(data, layout, k, v80)
        if not f: continue
        if f["flags"] > 7 or f["sendOption"] > 7: continue
        if f["length"] != total - f["headerLen"]: continue
        vistos.append((kind, layout, f))
    if not vistos: return None
    if ligero and len(vistos) == 1 and vistos[0][2]["cmd"] not in _CMDS_LEER_COMPLETO:
        kind, layout, f = vistos[0]
        hl = f["headerLen"]
        contenido = None if f["flags"] & 1 else data[hl:hl + f["length"]]
        return {"kind":kind, "layout":list(layout), "headerLen":hl,
            "msgKey":data[0], "cmd":f["cmd"], "flags":f["flags"],
            "sendOption":f["sendOption"], "orderId":f.get("orderId"),
            "length":f["length"], "content":contenido, "crcOk":None, "score":0}
    crc_ok = (data[1] & 0x7F) == _crc7(data[2:])
    candidates = []
    for kind, layout, f in vistos:
        hl = f["headerLen"]
        body = data[hl:hl + f["length"]]
        if f["flags"] & 1:
            if len(body) < 8 or len(body) % 8 != 0: continue
            content = _quitar_relleno(tea_cbc_decrypt_sync(body, key))
            if content is None: continue
        else: content = body
        score = (1 if crc_ok else 0) + (1 if content is not None else 0)
        candidates.append({"kind":kind, "layout":list(layout), "headerLen":hl,
            "msgKey":data[0], "cmd":f["cmd"], "flags":f["flags"],
            "sendOption":f["sendOption"], "orderId":f.get("orderId"),
            "length":f["length"], "content":content, "crcOk":crc_ok, "score":score})
    if not candidates: return None
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[0]

async def decode_packet(packet, key, mask=None, ligero=False):
    return decode_packet_sync(packet, key, mask, ligero)

# ==================== CONTADOR DE PARTIDAS ====================
_match_counters: Dict[str, int] = {}
_match_counter_lock = asyncio.Lock()

async def _inc_match(uid):
    async with _match_counter_lock:
        _match_counters[uid] = _match_counters.get(uid, 0) + 1
        return _match_counters[uid]

async def _dec_match(uid):
    async with _match_counter_lock:
        if uid in _match_counters and _match_counters[uid] > 0:
            _match_counters[uid] -= 1
        return _match_counters.get(uid, 0)

# ==================== CACHÉ DE SESIONES ====================
_token_cache_memo: Dict[str, Any] = {}
_token_cache_memo_time: float = 0.0
_TOKEN_CACHE_MEMO_TTL = 5.0

def _json_serializer(obj):
    if isinstance(obj, (bytes, bytearray)): return {"__bytes_hex__": bytes(obj).hex()}
    raise TypeError(f"Type {type(obj)} not serializable")

def _json_deserializer(obj):
    if isinstance(obj, dict):
        if "__bytes_hex__" in obj and len(obj) == 1:
            try: return bytes.fromhex(obj["__bytes_hex__"])
            except Exception: return b""
        return {k: _json_deserializer(v) for k, v in obj.items()}
    if isinstance(obj, list): return [_json_deserializer(x) for x in obj]
    return obj

def _load_token_cache():
    global _token_cache_memo, _token_cache_memo_time
    now = time.time()
    if _token_cache_memo and (now - _token_cache_memo_time) < _TOKEN_CACHE_MEMO_TTL:
        return _token_cache_memo
    if not os.path.exists(TOKEN_CACHE_FILE): return {}
    try:
        with open(TOKEN_CACHE_FILE,"r",encoding="utf-8") as f: content = f.read().strip()
        if not content: return {}
        data = json.loads(content)
        parsed = _json_deserializer(data)
        _token_cache_memo = parsed; _token_cache_memo_time = now
        return parsed
    except Exception:
        try: os.remove(TOKEN_CACHE_FILE)
        except Exception: pass
        return {}

def _save_token_cache(cache):
    global _token_cache_memo, _token_cache_memo_time
    try:
        with open(TOKEN_CACHE_FILE,"w",encoding="utf-8") as f:
            json.dump(cache, f, indent=2, default=_json_serializer)
        _token_cache_memo = cache; _token_cache_memo_time = time.time()
    except Exception as e: print_error(f"[CACHÉ] No se pudo guardar: {e}")

def cache_get(uid):
    cache = _load_token_cache()
    e = cache.get(str(uid))
    if not e: return None
    if time.time() - e.get("cached_at",0) > TOKEN_CACHE_TTL:
        cache_invalidate(uid); return None
    if str(e.get("account_id","")).isdigit(): e["account_id"] = int(e["account_id"])
    if not isinstance(e.get("login_payload_data"), (bytes, bytearray)):
        cache_invalidate(uid); return None
    return e

def cache_set(uid, data):
    cache = _load_token_cache()
    e = dict(data); e["cached_at"] = time.time()
    cache[str(uid)] = e; _save_token_cache(cache)

def cache_invalidate(uid):
    cache = _load_token_cache()
    if str(uid) in cache:
        del cache[str(uid)]; _save_token_cache(cache)

# ==================== JUGAR LA PARTIDA ====================
async def play_game(server_ip_port, thunder, sharma, udp_key, match_code,
                    account_id, player_region, client_version, key, iv, match_index):
    match_start_time = time.time()
    ping_task = None; sock = None
    ping_stop = asyncio.Event()
    movement_ctrl = None
    uid_str = str(account_id)
    completed_cleanly = False
    try:
        ip, port = server_ip_port.split(":")
        port = int(port)
        resolved_ip = await resolve_host_cloudflare(ip)
        loop = asyncio.get_event_loop()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try: sock.bind(('0.0.0.0', 0))
        except Exception: pass
        optimize_udp_socket(sock); sock.setblocking(False)
        udp_key_bytes = bytes.fromhex(udp_key)
        hello_packet = await build_hello_packet(f"{account_id}_2585", udp_key_bytes, match_code)
        await loop.sock_sendto(sock, bytes.fromhex(hello_packet), (resolved_ip, port))
        ack_state = "waiting_for_hello_reply"
        thunder_sent = False
        join_match_received = False
        local_closed = False
        send_lock = asyncio.Lock()
        ping_task = asyncio.create_task(keepalive_ping(sock, resolved_ip, port, udp_key_bytes, match_code, ping_stop))
        last_activity = time.time()
        movement_ctrl = MovementController(
            account_id=account_id, account_region=player_region,
            key=key, iv=iv, tcp_writer=None,
            udp_sock=sock, udp_server=(resolved_ip, port),
            udp_key_bytes=udp_key_bytes, match_code=match_code)

        async def send_thunder_sharma_inline():
            nonlocal ack_state, thunder_sent
            if thunder_sent: return
            async with send_lock:
                if thunder_sent: return
                try:
                    await loop.sock_sendto(sock, bytes.fromhex(thunder), (resolved_ip, port))
                    thunder_sent = True
                    await asyncio.sleep(0.3)
                    prepare_ack = await build_packet(0x68, (await layouts_from_mask(match_code))[1],
                                                     0, 2, None, 1, b"\x01\x00", udp_key_bytes)
                    await loop.sock_sendto(sock, prepare_ack, (resolved_ip, port))
                    await asyncio.sleep(0.4)
                    await loop.sock_sendto(sock, bytes.fromhex(sharma), (resolved_ip, port))
                    ack_state = "thunder_sharma_sent"
                    print_premium(f"[PARTIDA #{match_index}] Jugando dentro de la partida",
                                  color=PX.LIME, icon=I["flame"])
                    movement_ctrl.start()
                except Exception as e:
                    print_error(f"[PARTIDA #{match_index}] Error al entrar: {e}")

        while not local_closed:
            if time.time() - match_start_time > MAX_MATCH_DURATION:
                completed_cleanly = True; break
            try:
                response, server_addr = await asyncio.wait_for(loop.sock_recvfrom(sock, 65535), timeout=2.0)
                if response:
                    last_activity = time.time()
                    frame = decode_packet_sync(response, udp_key_bytes, match_code, ligero=True)
                    if frame:
                        movement_ctrl.set_server_addr(server_addr)
                        movement_ctrl.note_server_frame(frame.get("cmd"))
                        movement_ctrl.mark_ready()
                        ptype = await classify(frame)
                        if frame['cmd'] in [103, 107]:
                            print_premium(f"[PARTIDA #{match_index}] Fin", color=PX.MAGENTA, icon=I["star"])
                            completed_cleanly = True; local_closed = True
                            continue
                        if frame['cmd'] == 101:
                            try:
                                ack = await build_packet(0x68, (await layouts_from_mask(match_code))[1],
                                                         0,2,None,1, b"\x01\x00", udp_key_bytes)
                                await loop.sock_sendto(sock, ack, server_addr)
                            except Exception: pass
                            continue
                        if ptype in ["ACK","PING","HELLO","JOIN_MATCH"]:
                            if ptype == "HELLO" and ack_state == "waiting_for_hello_reply":
                                typ, reply = await reply_for(frame, udp_key_bytes, match_code, ack_style="short")
                                if reply: await loop.sock_sendto(sock, reply, server_addr)
                                ack_state = "ack_sent_waiting"
                            elif ptype == "ACK":
                                if ack_state == "waiting_for_hello_reply":
                                    typ, reply = await reply_for(frame, udp_key_bytes, match_code)
                                    if reply: await loop.sock_sendto(sock, reply, server_addr)
                                    ack_state = "ready_to_send_thunder"
                                elif ack_state == "ack_sent_waiting": ack_state = "ready_to_send_thunder"
                                else:
                                    typ, reply = await reply_for(frame, udp_key_bytes, match_code)
                                    if reply: await loop.sock_sendto(sock, reply, server_addr)
                            elif ptype == "PING":
                                typ, reply = await reply_for(frame, udp_key_bytes, match_code)
                                if reply: await loop.sock_sendto(sock, reply, server_addr)
                            elif ptype == "JOIN_MATCH" and not join_match_received:
                                typ, reply = await reply_for(frame, udp_key_bytes, match_code)
                                if reply:
                                    await loop.sock_sendto(sock, reply, server_addr)
                                    join_match_received = True
            except asyncio.TimeoutError:
                if ack_state == "ready_to_send_thunder" and not thunder_sent:
                    await send_thunder_sharma_inline()
                elif ack_state == "waiting_for_hello_reply":
                    if (time.time() - last_activity) > 7.0:
                        try:
                            pkt = await build_hello_packet(f"{account_id}_2585", udp_key_bytes, match_code)
                            await loop.sock_sendto(sock, bytes.fromhex(pkt), (resolved_ip, port))
                        except Exception: pass
                        last_activity = time.time()
                    if (time.time() - match_start_time) > 25.0:
                        print_warning(f"[PARTIDA #{match_index}] El servidor no contestó"); break
                elif ack_state == "thunder_sharma_sent":
                    if (time.time() - last_activity) > MATCH_IDLE_TIMEOUT:
                        completed_cleanly = True; break
            except (BlockingIOError, OSError):
                await asyncio.sleep(0.5); continue
            except Exception:
                await asyncio.sleep(0.5); continue
            if ack_state == "ready_to_send_thunder" and not thunder_sent:
                await send_thunder_sharma_inline()
        return f"match #{match_index} finished"
    except Exception as e:
        print_error(f"[PARTIDA #{match_index}] {e}")
        return f"match #{match_index} error"
    finally:
        if movement_ctrl:
            try: await movement_ctrl.stop()
            except Exception: pass
        if completed_cleanly:
            try:
                bot_state.increment_match(uid_str)
                print_premium(f"[PARTIDA #{match_index}] Terminada · {uid_str}",
                              color=PX.GOLD, icon=I["crown"])
                try: await _mark_bot_match_finished(uid_str)
                except Exception: pass
                async def _post_exp(uid):
                    try:
                        for wait in (5.0, 8.0, 12.0):
                            await asyncio.sleep(wait)
                            await refresh_account_profile(uid)
                    except Exception: pass
                asyncio.create_task(_post_exp(uid_str))
            except Exception: pass
        ping_stop.set()
        if ping_task:
            ping_task.cancel()
            try: await ping_task
            except asyncio.CancelledError: pass
        if sock:
            try: sock.close()
            except Exception: pass
        remaining = await _dec_match(uid_str)
        try: bot_state.update_status(uid_str, "ONLINE" if remaining == 0 else "IN_MATCH", remaining)
        except Exception: pass

# ==================== CONEXIÓN DE CADA BOT ====================
# ---------- Diagnóstico de paquetes de equipo ----------
# Guarda en logs/equipo.log un resumen de cada aviso de equipo que llega (máximo ~1 MB).
# Si algún día una escuadra se porta raro, ese archivo dice exactamente qué mandó el juego.
DIAG_EQUIPO = os.environ.get("DIAGNOSTICO_EQUIPO", "1") != "0"
_DIAG_RUTA = os.path.join("logs", "equipo.log")
_DIAG_MAX = 1_000_000

def _diag_equipo(uid, escuadra_n, dec, grupo, ids):
    if not DIAG_EQUIPO:
        return
    try:
        os.makedirs("logs", exist_ok=True)
        if os.path.exists(_DIAG_RUTA) and os.path.getsize(_DIAG_RUTA) > _DIAG_MAX:
            os.replace(_DIAG_RUTA, _DIAG_RUTA + ".1")
        cuerpo = json.dumps(dec, default=str, ensure_ascii=False)
        if len(cuerpo) > 1500:
            cuerpo = cuerpo[:1500] + "..."
        st = _squads.get(escuadra_n) or {}
        linea = (f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {escuadra_n} bot={uid} "
                 f"lider={st.get('leader_uid')} grupo={grupo} ids={sorted(ids)} {cuerpo}\n")
        with open(_DIAG_RUTA, "a", encoding="utf-8") as f:
            f.write(linea)
    except Exception:
        pass


async def functional_lone_wolf(addrs, starter_packet, account_region, client_version,
                                key, iv, account_id="", account_data=None, max_reconnects=10):
    reconnects = 0
    conectado_en = 0.0
    caidas_rapidas = 0
    ip, port = addrs.split(":")
    play_matches: List[asyncio.Task] = []
    no_response_count = 0
    search_attempts = 0
    last_start_time = 0.0
    uid_str = str(account_id)

    current_token = starter_packet
    current_key = key; current_iv = iv
    current_account_data = account_data
    _writer_ref = {"w": None}
    _team_active = {"flag": True}
    _match_played = {"flag": False}
    # A qué escuadra pertenece este bot (grupos de 4 según el orden de accounts.json)
    _squad = _estado_escuadra(uid_str)
    _squad_label = _etiqueta_escuadra(_squad["nombre"])
    # Cuántos bots se esperan en ESTA escuadra (la última puede quedar con menos de 4)
    _squad_espera = _bots_de_escuadra(_squad["nombre"])

    def _esperados():
        """Cuántos bots le tocan a esta escuadra AHORA. Se vuelve a leer cada vez, así que
        si desde el panel mandas uno más, el líder ya lo cuenta y lo invita."""
        try:
            n = int(_bots_de_escuadra(_squad["nombre"]))
        except Exception:
            n = _squad_espera
        return max(1, min(TEAM_SIZE, n))

    async def _process_social_packet(raw_bytes, tag="PRINCIPAL"):
        try:
            hex_data = raw_bytes.hex()
            candidates = []
            if len(raw_bytes) >= 6:
                plen = raw_bytes[4]
                if 0 < plen <= (len(raw_bytes) - 5):
                    try:
                        inner = bytes(raw_bytes[5:5 + plen])
                        d0 = decode_protobuf_dict(inner)
                        if not d0:
                            a0 = decode_protobuf_2(inner)
                            if a0: d0 = {str(k): {"data": v} for k, v in a0.items()}
                        if d0: candidates.append((5, d0))
                    except Exception: pass
            for off in [5, 6, 10, 8, 12, 14, 4, 16, 0]:
                if off >= len(hex_data): continue
                try: inner_bytes = bytes.fromhex(hex_data[off:])
                except Exception: continue
                decoded = None
                try:
                    d1 = decode_protobuf_dict(inner_bytes)
                    if d1: decoded = d1
                except Exception: pass
                if not decoded:
                    try:
                        d2 = decode_protobuf_2(inner_bytes)
                        if d2: decoded = {str(k): {"data": v} for k, v in d2.items()}
                    except Exception: pass
                if decoded: candidates.append((off, decoded))
            if not candidates: return
            def _score(item):
                _off, d = item
                s = len(d)
                if "0" in d or 0 in d: s -= 100
                if "5" in d: s += 6
                if "1" in d: s += 4
                if "2" in d: s += 2
                return s
            candidates.sort(key=_score, reverse=True)
            best_off, decoded = candidates[0]
            def _val(container, k):
                if not isinstance(container, dict): return None
                v = container.get(k) if k in container else container.get(str(k))
                if isinstance(v, dict) and "data" in v: return v["data"]
                return v
            f5wrap = decoded.get("5") or decoded.get(5)
            f5 = None
            if isinstance(f5wrap, dict) and "data" in f5wrap: f5 = f5wrap["data"]
            elif isinstance(f5wrap, dict): f5 = f5wrap
            target_uid = None
            if isinstance(f5, dict):
                for fk in [1,2,3,4,6]:
                    cand = _val(f5, fk)
                    if cand and str(cand).isdigit() and 6 <= len(str(cand)) <= 15:
                        target_uid = str(cand); break
            if not target_uid: return
            own_acc = None
            if current_account_data: own_acc = str(current_account_data.get('account_id', ''))
            if own_acc and target_uid == own_acc: return
            if not _accept_friend_request or not current_account_data: return
            jwt_l = current_account_data.get('token')
            srv_l = current_account_data.get('server_url')
            rel_l = current_account_data.get('release_version')
            own_id = current_account_data.get('account_id')
            if not (jwt_l and srv_l and rel_l and own_id): return
            url = f"{srv_l.rstrip('/')}/ConfirmFriendRequest"
            fields = {"1": int(DEV_UID), "2": int(own_id)}
            try:
                payload = bytes.fromhex(encrypt_aes(create_proto(fields).hex()))
                hdrs = {
                    "authorization": f"Bearer {jwt_l}",
                    "host": srv_l.replace("https://", "").replace("http://", "").split("/")[0],
                    "x-ga": "v1 1", "content-type": "application/x-www-form-urlencoded",
                    "accept-encoding": "deflate, gzip", "releaseversion": f"{rel_l}",
                    "user-agent": "UnityPlayer/2022.3.47f1",
                    "accept": "*/*", "x-unity-version": "2022.3.47f1",
                }
                ssl_ctx = ssl.create_default_context()
                ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
                    async with s.post(url, headers=hdrs, data=payload, ssl=ssl_ctx) as r:
                        body = await r.read()
                        if r.status == 200 and len(body) > 0:
                            print_success(f"[AMIGOS] {tag}: aceptó a {target_uid}")
            except Exception as e:
                print_warning(f"[AMIGOS] {tag}: {type(e).__name__}: {e}")
        except Exception as e:
            print_warning(f"[SOCIAL] {tag}: {type(e).__name__}: {e}")

    # ---------- Cerebro de escuadra (escuadra.py) ----------
    # Todo lo que decide (invitar, aceptar, iniciar) está en escuadra.py. Aquí solo se
    # conecta con el juego: cómo mandar cada paquete y cómo avisar en consola.
    async def _enviar(pkt):
        w = _writer_ref["w"]
        if w and not w.is_closing():
            w.write(pkt); await w.drain()

    def _mi_id():
        v = current_account_data.get('account_id') if current_account_data else None
        try: return int(v or uid_str)
        except Exception: return 0

    _niveles_log = {"info": print_info, "aviso": print_warning, "ok": print_success}

    def _io_log(nivel, texto):
        msg = f"[EQUIPO] {_squad_label}: {texto}"
        if nivel == "lider":
            print_premium(msg, color=PX.GOLD, icon=I["crown"])
        else:
            _niveles_log.get(nivel, print_info)(msg)

    async def _io_crear():
        modo = _modo_de_escuadra(_squad)
        if _squad.get("modo") != modo:
            _squad["modo"] = modo
            if modo == "br_ranked":
                print_premium(f"[MODO] {_squad_label}: BR-CLASIFICATORIA "
                              f"(modo {_modo_y_mapa(modo)[0]}, mapa aleatorio)",
                              color=PX.ROSE, icon=I["crown"])
            else:
                print_info(f"[MODO] {_squad_label}: Battle Royale normal "
                           f"(la clasificatoria pide nivel {RANKED_MIN_LEVEL})")
        _squad["team_code"] = None
        await _enviar(create_team(current_key, current_iv, region=account_region,
                                  game_version=client_version, mode=_squad.get("modo")))

    async def _io_refrescar():
        await _enviar(team_fresh(_mi_id(), current_key, current_iv))

    async def _io_invitar(gid):
        await _enviar(invite_player_in_team(int(gid), current_key, current_iv,
                                            region=account_region))

    async def _io_listo():
        await _enviar(ready_for_game(_mi_id(), current_key, current_iv))

    async def _io_iniciar():
        await _enviar(start_match_team(_mi_id(), current_key, current_iv, region=account_region))

    def _io_id_juego(u):
        try:
            info = (_squad.get("peers") or {}).get(u) or {}
            return int((info.get("data") or {}).get("account_id") or u)
        except Exception:
            return int(u)

    def _io_num_escuadra():
        n = "".join(ch for ch in str(_squad["nombre"]) if ch.isdigit())
        return int(n) if n else 1

    _inv_usuario = {"t": 0.0}

    async def _io_toca_esperar():
        if await _toca_esperarte(_squad, _squad_label, uid_str):
            return True
        _squad["invitar_uid"] = None
        return False

    async def _io_invitar_usuario():
        inv = _squad.get("invitar_uid")
        if not inv or time.time() - _inv_usuario["t"] < 25.0:
            return
        _inv_usuario["t"] = time.time()
        for _ in range(2):
            try:
                await _enviar(invite_player_in_team(int(inv), current_key, current_iv,
                                                    region=account_region))
            except Exception as e:
                print_warning(f"[EQUIPO] {_squad_label}: error al invitarte: {e}")
            await asyncio.sleep(0.6)
        print_info(f"[EQUIPO] 📨 {_squad_label}: te invita ({inv}); acepta en el juego")

    def _io_esperando_usuario():
        return (float(_squad.get("esperar_hasta") or 0) > time.time()
                or bool(_squad.get("esperar_pendiente")))

    def _io_hacerse_lider():
        nonlocal team_coord_task
        if not (team_coord_task and not team_coord_task.done()):
            team_coord_task = asyncio.create_task(_team_coordinator(rearme=True))

    def _io_hacerse_miembro():
        nonlocal member_trigger_task
        if not (member_trigger_task and not member_trigger_task.done()):
            member_trigger_task = asyncio.create_task(_member_match_trigger(rearme=True))

    def _io_estado(e):
        try: bot_state.update_status(uid_str, e, 0)
        except Exception: pass

    _io = types.SimpleNamespace(
        uid=uid_str, sq=_squad,
        ahora=time.time, dormir=asyncio.sleep,
        activo=lambda: _team_active["flag"] and not _match_played["flag"],
        pausado=lambda: bot_state.is_paused(uid_str),
        esta_pausado=lambda u: bot_state.is_paused(str(u)),
        log=_io_log, fase=lambda f: _fase(_squad, f), estado=_io_estado,
        crear_equipo=_io_crear, refrescar_equipo=_io_refrescar, invitar=_io_invitar,
        listo=_io_listo, iniciar=_io_iniciar, id_juego=_io_id_juego,
        esperados=_esperados, numero_escuadra=_io_num_escuadra,
        toca_esperar=_io_toca_esperar, invitar_usuario=_io_invitar_usuario,
        esperando_usuario=_io_esperando_usuario,
        hacerse_lider=_io_hacerse_lider, hacerse_miembro=_io_hacerse_miembro,
    )

    async def _team_coordinator(rearme=False):
        try:
            await escuadra.ciclo_lider(_io, rearme)
        except asyncio.CancelledError: raise
        except Exception as e:
            print_error(f"[EQUIPO] {_squad_label}: error del líder: {e}")

    async def _member_match_trigger(rearme=False):
        try:
            await escuadra.ciclo_miembro(_io, rearme)
        except asyncio.CancelledError: raise
        except Exception as e:
            print_warning(f"[EQUIPO] {_squad_label}: error del miembro: {e}")

    try:
        while True:
            while bot_state.is_paused(uid_str):
                try: bot_state.update_status(uid_str, "PAUSED", 0)
                except Exception: pass
                await asyncio.sleep(1.0)
            writer = None; gateway_ping_task = None
            team_coord_task = None; member_trigger_task = None; vigilante_task = None
            try:
                if current_account_data:
                    fresh = None
                    if current_account_data.get('auth_type') == 'guest' and current_account_data.get('auth_uid'):
                        fresh = cache_get(str(current_account_data['auth_uid']))
                    elif current_account_data.get('auth_type') == 'token' and current_account_data.get('auth_token'):
                        fresh = cache_get(f"tok_{current_account_data['auth_token'][:20]}")
                    if fresh:
                        current_account_data = fresh
                        current_key = fresh['aes_ak']; current_iv = fresh['iv_i']
                        current_token = await build_tcp_startup_packet(
                            fresh['account_id'], fresh['token'], fresh['server_time'],
                            current_key, current_iv,
                            region=fresh.get('region', account_region), typ='OnLine')
                    else: raise ConnectionError("Cache expired")
                resolved_ip = await resolve_host_cloudflare(ip)
                reader, writer = await asyncio.open_connection(resolved_ip, int(port))
                bot_state.register_writer(uid_str, writer)
                _writer_ref["w"] = writer
                raw_sock = writer.get_extra_info('socket')
                if raw_sock: optimize_tcp_socket(raw_sock)
                writer.write(bytes.fromhex(current_token)); await writer.drain()
                try:
                    init_ka = await send_keep_alive(account_region)
                    if init_ka and not writer.is_closing():
                        writer.write(init_ka)
                        await asyncio.wait_for(writer.drain(), timeout=3)
                except Exception: pass

                async def func_gateway_keepalive():
                    ka_bytes = await send_keep_alive(account_region)
                    while True:
                        await asyncio.sleep(5)
                        try:
                            if writer and not writer.is_closing():
                                writer.write(ka_bytes); await writer.drain()
                        except Exception: break

                gateway_ping_task = asyncio.create_task(func_gateway_keepalive())
                print_premium(f"[CONEXIÓN] Conectado al juego · {uid_str} · región {account_region}",
                              color=PX.MINT, icon=I["check"])
                reconnects = 0; no_response_count = 0
                conectado_en = time.time()
                if ENABLE_NEWBIE_CHARACTER and NEWBIE_SELECT_BEFORE_TEAM:
                    print_warning("Elegir personaje nuevo está encendido; puede cortar la conexión")
                async with _squad["lock"]:
                    _squad["peers"][uid_str] = {
                        "writer": writer, "data": current_account_data,
                        "key": current_key, "iv": current_iv,
                        "region": account_region,
                        # cuándo se conectó: si cambia, el líder sabe que se reconectó
                        "conectado": time.time()}
                    if _squad["leader_uid"] is None:
                        otros = [u for u in _squad["peers"] if u != uid_str]
                        if not otros:
                            _squad["leader_uid"] = uid_str
                            print_premium(f"[EQUIPO] 👑 {_squad_label}: {uid_str} es el primero: será el líder",
                                          color=PX.GOLD, icon=I["crown"])
                        # Si ya hay otros conectados, el líder lo toma uno de ellos (que llevan
                        # rato estables). Así un bot que se cae y vuelve a cada rato no deja a
                        # su escuadra sin líder.
                try: await _mark_team_joined(uid_str)
                except Exception: pass

                async def send_solo_start_match():
                    nonlocal search_attempts
                    search_attempts += 1
                    try:
                        try: bot_state.update_status(uid_str, "SEARCHING", 0)
                        except Exception: pass
                        await asyncio.sleep(random.uniform(0.2, 0.4))
                        try:
                            own_id = current_account_data.get('account_id') if current_account_data else uid_str
                            rdy = ready_for_game(int(own_id), current_key, current_iv)
                            if writer and not writer.is_closing():
                                writer.write(rdy); await writer.drain()
                        except Exception: pass
                        await asyncio.sleep(1.0)
                        await start_game_battle_royale(account_region, client_version, writer, current_key, current_iv)
                    except Exception as e: print_warning(f"[EQUIPO] Error jugando solo: {e}")

                async def _vigilante_bot():
                    """Revisa cada 15 s que el bot NO se quede parado "En línea".
                    Si se le apagaron las tareas o su escuadra se quedó sin líder, lo revive.
                    Así ningún bot se queda esperando turno."""
                    nonlocal team_coord_task, member_trigger_task
                    await asyncio.sleep(30.0)
                    while True:
                        await asyncio.sleep(15.0)
                        try:
                            if not TEAM_MODE: continue
                            if bot_state.is_paused(uid_str): continue
                            if _match_played["flag"]: continue
                            if any(not m.done() for m in play_matches): continue
                            if float(_squad.get("esperar_hasta") or 0) > time.time(): continue
                            # 1) ¿se quedó la escuadra sin líder? este bot lo toma
                            async with _squad["lock"]:
                                lid = _squad.get("leader_uid")
                                sin_lider = (not lid) or (lid not in _squad["peers"])
                                if sin_lider and uid_str in _squad["peers"]:
                                    _squad["leader_uid"] = uid_str
                                    _squad["team_code"] = None
                                    escuadra.equipo_nuevo(_squad)
                            if sin_lider:
                                print_premium(f"[EQUIPO] 👑 {_squad_label}: nadie llevaba el equipo; "
                                              f"lo toma {uid_str}", color=PX.GOLD, icon=I["crown"])
                            # 2) ¿se le apagaron las tareas? se vuelven a encender
                            vivo = (team_coord_task and not team_coord_task.done()) or \
                                   (member_trigger_task and not member_trigger_task.done())
                            if sin_lider or not vivo:
                                if not vivo:
                                    print_warning(f"[EQUIPO] {_squad_label}: {uid_str} estaba parado; "
                                                  f"se reactiva")
                                _team_active["flag"] = True
                                for tk in (team_coord_task, member_trigger_task):
                                    if tk and not tk.done(): tk.cancel()
                                team_coord_task = asyncio.create_task(_team_coordinator(rearme=True))
                                member_trigger_task = asyncio.create_task(_member_match_trigger(rearme=True))
                        except asyncio.CancelledError: raise
                        except Exception: pass

                if not _match_played["flag"]:
                    if not TEAM_MODE: await send_solo_start_match()
                    if TEAM_MODE:
                        team_coord_task = asyncio.create_task(_team_coordinator())
                        member_trigger_task = asyncio.create_task(_member_match_trigger())
                else:
                    print_info(f"[ESPERA] {uid_str} vuelve al modo de espera")
                vigilante_task = asyncio.create_task(_vigilante_bot())

                # ---- Lector de avisos del juego ----
                # El juego manda sus avisos pegados uno detrás de otro por la misma conexión,
                # y a veces parte uno en dos trozos. Antes el bot leía "lo que llegara" y lo
                # trataba como UN solo aviso: si en el mismo trozo venía primero un mensaje
                # del clan y detrás el "¡partida encontrada!", el de la partida se PERDÍA.
                # Por eso el juego los metía a la partida y el panel seguía diciendo
                # "Buscando partida". Ahora se separan uno por uno, bien.
                rxbuf = bytearray()

                def _sacar_aviso():
                    if len(rxbuf) < 5: return None
                    largo = int.from_bytes(bytes(rxbuf[2:5]), "big")
                    total = 5 + largo
                    if largo <= 0 or total > 262144:
                        d = bytes(rxbuf); rxbuf.clear(); return d
                    if len(rxbuf) < total: return None
                    d = bytes(rxbuf[:total]); del rxbuf[:total]
                    return d

                async def _siguiente_aviso(espera):
                    fin = time.time() + espera
                    while True:
                        d = _sacar_aviso()
                        if d is not None: return d
                        resto = fin - time.time()
                        if resto <= 0: return None
                        trozo = await asyncio.wait_for(reader.read(8192), timeout=resto)
                        if not trozo: raise ConnectionError("Connection closed")
                        rxbuf.extend(trozo)

                while True:
                    play_matches[:] = [m for m in play_matches if not m.done()]
                    if bot_state.is_paused(uid_str): break
                    if _match_played["flag"]:
                        try: data = await _siguiente_aviso(1.0)
                        except asyncio.TimeoutError: continue
                        if data is None: continue
                        if len(data) > 20 and data.hex().startswith("0600"):
                            await _process_social_packet(data, tag="ESPERA")
                        continue
                    now = asyncio.get_running_loop().time()
                    if not TEAM_MODE and len(play_matches) == 0 and (now - last_start_time >= START_MATCH_INTERVAL):
                        await send_solo_start_match()
                        last_start_time = now
                    try: data = await _siguiente_aviso(0.5)
                    except asyncio.TimeoutError:
                        no_response_count += 1; continue
                    if data is None:
                        no_response_count += 1; continue
                    hex_data = data.hex(); packet_length = len(data)
                    no_response_count = 0
                    if hex_data.startswith("0600") and packet_length > 20:
                        await _process_social_packet(data, tag="PRINCIPAL"); continue
                    if hex_data.startswith("0500") and packet_length > 10:
                        try:
                            inner = bytes.fromhex(hex_data[10:])
                            dec = decode_protobuf_dict(inner)
                            if not dec:
                                alt = decode_protobuf_2(inner)
                                if alt: dec = {str(k): {"data": v} for k, v in alt.items()}
                            f5w = dec.get("5") or dec.get(5)
                            f5 = f5w.get("data") if isinstance(f5w, dict) and "data" in f5w else f5w
                            if not isinstance(f5, dict): f5 = dec
                            def _f5g(key):
                                if not isinstance(f5, dict): return None
                                v = f5.get(key) if key in f5 else f5.get(str(key))
                                if isinstance(v, dict) and "data" in v: return v["data"]
                                return v
                            tc = None
                            for fk in [11, 5, 1, 3]:
                                cand = _f5g(fk)
                                if cand and str(cand).isdigit() and len(str(cand)) == 7:
                                    tc = str(cand); break
                            if tc and _squad.get("leader_uid") == uid_str and _squad.get("team_code") != tc:
                                _squad["team_code"] = tc
                                print_premium(f"[EQUIPO] 🔑 {_squad_label}: código del equipo {tc}",
                                              color=PX.ROSE, icon=I["gem"])
                            group_id = _f5g(8)
                            if not (group_id and isinstance(group_id, str) and 20 <= len(group_id) <= 40):
                                group_id = None
                            ids_pkt = escuadra.ids_en(dec)
                            _diag_equipo(uid_str, _squad["nombre"], dec, group_id, ids_pkt)
                            # ¿Es una invitación de SU líder, de un equipo que todavía no aceptó?
                            # (los avisos que el juego manda después sobre el mismo equipo no se
                            # vuelven a aceptar: eso lo sacaba y le cortaba la búsqueda)
                            lider_ok = escuadra.decidir_aceptar(_squad, uid_str, ids_pkt,
                                                                 group_id, time.time())
                            if lider_ok:
                                print_premium(f"[EQUIPO] 📨 {_squad_label}: {uid_str} acepta la "
                                              f"invitación de su líder", color=PX.CYAN, icon=I["arrow"])
                                try:
                                    acc = accept_team_invite(int(lider_ok), group_id,
                                                             current_key, current_iv,
                                                             region=account_region,
                                                             game_version=client_version)
                                    if writer and not writer.is_closing():
                                        writer.write(acc); await writer.drain()
                                except Exception as e:
                                    print_warning(f"[EQUIPO] Error al aceptar la invitación: {e}")
                        except Exception as e: print_warning(f"[EQUIPO] Error leyendo el paquete del equipo: {e}")
                        continue
                    if hex_data.startswith("0300") and 10 < packet_length < 30: continue
                    # Antes solo se miraban los avisos de 300 bytes para arriba. Si a un bot
                    # le llegaba uno más corto, lo tiraba a la basura y se quedaba buscando
                    # mientras sus compañeros entraban. Ahora se mira cualquiera que pueda
                    # traer los datos de la partida: si los trae, entra; si no, sigue igual.
                    if hex_data.startswith("0300") and packet_length >= 120:
                        # PRIMERO se lee el aviso. Solo si trae TODO lo necesario se da la
                        # partida por buena. Antes el bot apagaba sus tareas antes de leerlo:
                        # si el aviso venía incompleto se quedaba muerto "En línea" para
                        # siempre, y por eso veías bots parados y escuadras jugando por turnos.
                        token = udp_key = match_code = server_ip_port = None
                        match_account_id = block_val = None
                        try:
                            res = json.loads(await decode_protobuf_async(hex_data[10:]))
                            if '42' in res and 'data' in res['42']: match_code = res['42']['data']
                            if '5' in res and 'data' in res['5']:
                                rf5 = res['5']['data']
                                server_ip_port = rf5.get('2', {}).get('data')
                                udp_key = rf5.get('3', {}).get('data')
                                token = rf5.get('4', {}).get('data')
                                if '42' in rf5: match_code = rf5['42']['data']
                            if '1' in res and 'data' in res['1']: match_account_id = res['1']['data']
                            if '5' in res and 'data' in res['5']:
                                block_val = res['5']['data'].get('1', {}).get('data')
                        except Exception:
                            pass
                        if not (token and udp_key and match_code and server_ip_port):
                            # Solo avisa si era un aviso grande (ese sí debía ser la partida).
                            # Los chicos son mensajes normales del juego y no molestan.
                            if packet_length >= 300:
                                print_warning(f"[PARTIDA] {uid_str}: el aviso vino incompleto; "
                                              f"sigue buscando (no se queda parado)")
                            if TEAM_MODE and not _match_played["flag"]:
                                _team_active["flag"] = True
                                vivo = (team_coord_task and not team_coord_task.done()) or \
                                       (member_trigger_task and not member_trigger_task.done())
                                if not vivo:
                                    team_coord_task = asyncio.create_task(_team_coordinator(rearme=True))
                                    member_trigger_task = asyncio.create_task(_member_match_trigger(rearme=True))
                            continue
                        print_premium(f"[PARTIDA] ¡Partida encontrada! {uid_str} · región {account_region}",
                                      color=PX.AMBER, icon=I["target"])
                        try: await _mark_match_found(uid_str)
                        except Exception: pass
                        # Apunta que este bot entró a la partida (el líder lo usa para saber
                        # quién sigue en el equipo y para esperar a que todos terminen).
                        escuadra.marcar_entra_partida(_squad, uid_str, time.time())
                        _fase(_squad, "en_partida")
                        try: await _clear_team_joined(uid_str)
                        except Exception: pass
                        for tk in (team_coord_task, member_trigger_task):
                            if tk and not tk.done(): tk.cancel()
                        team_coord_task = None; member_trigger_task = None
                        _team_active["flag"] = False
                        try:
                            effective_acc_id = match_account_id or account_id or "BD_BOT"
                            acc_tok = current_account_data.get('access_token', '') if current_account_data else ""
                            thunder, sharma = await build_match_startup_packets(
                                token, udp_key, match_code, effective_acc_id, block_val or 0,
                                server_ip=server_ip_port, region=account_region,
                                client_version=client_version, access_token=acc_tok,
                                mode_id=_modo_y_mapa(_squad.get("modo"))[0],
                                map_id=(_modo_y_mapa(_squad.get("modo"))[1] or 0))
                            match_index = await _inc_match(uid_str)
                            print_info(f"[PARTIDA #{match_index}] Servidor {server_ip_port}")
                            try:
                                bot_state.increment_match_started()
                                bot_state.update_status(uid_str, "IN_MATCH (TEAM)", 1)
                            except Exception: pass
                            new_match = asyncio.create_task(
                                play_game(server_ip_port, thunder, sharma, udp_key,
                                          match_code, effective_acc_id, account_region,
                                          client_version, current_key, current_iv,
                                          match_index=match_index))
                            play_matches.append(new_match)

                            async def drain_gw():
                                while not new_match.done():
                                    try:
                                        dg = await asyncio.wait_for(reader.read(4096), timeout=1.0)
                                        if not dg: break
                                        gh = dg.hex()
                                        if gh.startswith("0600") and len(dg) > 20:
                                            await _process_social_packet(dg, tag="LIMPIEZA")
                                    except asyncio.TimeoutError: continue
                                    except Exception: break
                            drain_task = asyncio.create_task(drain_gw())
                            try: await new_match
                            except Exception as e: print_error(f"[PARTIDA #{match_index}] {e}")
                            finally:
                                drain_task.cancel()
                                try: await drain_task
                                except asyncio.CancelledError: pass
                            play_matches[:] = [m for m in play_matches if not m.done()]
                            rxbuf.clear()
                            escuadra.marcar_sale_partida(_squad, uid_str)
                            # Terminó la partida: la escuadra se vuelve a armar y busca otra.
                            _match_played["flag"] = False
                            _team_active["flag"] = True
                            if TEAM_MODE:
                                for tk in (team_coord_task, member_trigger_task):
                                    if tk and not tk.done(): tk.cancel()
                                team_coord_task = asyncio.create_task(_team_coordinator(rearme=True))
                                member_trigger_task = asyncio.create_task(_member_match_trigger(rearme=True))
                                print_info(f"[EQUIPO] {_squad_label}: terminó la partida, arma el equipo otra vez")
                            else:
                                print_premium(f"[ESPERA] {uid_str} descansa después de la partida",
                                              color=PX.SLATE, icon=I["dot"])
                            continue
                        except Exception as e:
                            # Antes la marca de "en partida" se quedaba puesta y el líder se
                            # quedaba esperando a este bot para siempre. Ahora se borra.
                            escuadra.marcar_sale_partida(_squad, uid_str)
                            print_warning(f"[PARTIDA] {uid_str}: no pudo entrar ({e}); vuelve a buscar")
                            # Si algo falla al entrar, el bot NO se queda parado: revive.
                            _match_played["flag"] = False
                            _team_active["flag"] = True
                            if TEAM_MODE:
                                team_coord_task = asyncio.create_task(_team_coordinator(rearme=True))
                                member_trigger_task = asyncio.create_task(_member_match_trigger(rearme=True))
                            continue
                    if 30 <= packet_length <= 40: continue
            except asyncio.CancelledError: raise
            except Exception as e:
                if "Cache expired" in str(e):
                    print_warning(f"[CUENTA] Se venció la sesión de {uid_str}"); break
                reconnects += 1
                if reconnects > max_reconnects:
                    if current_account_data:
                        try:
                            if current_account_data.get('auth_uid'):
                                cache_invalidate(str(current_account_data['auth_uid']))
                            if current_account_data.get('auth_token'):
                                cache_invalidate(f"tok_{current_account_data['auth_token'][:20]}")
                        except Exception: pass
                    reconnects = 0; break
                # Si el juego lo corta enseguida de conectar, cada vez espera más antes de volver
                # (antes se reconectaba cada medio segundo sin parar)
                if time.time() - conectado_en < CAIDA_RAPIDA_SEG:
                    caidas_rapidas += 1
                else:
                    caidas_rapidas = 0
                espera_rec = min(2.0 + caidas_rapidas * 5.0, RECONEXION_MAX_SEG) if caidas_rapidas else min(reconnects * 0.5, 2.0)
                if caidas_rapidas >= 3:
                    print_warning(f"[CONEXIÓN] {uid_str}: el juego lo desconecta apenas entra "
                                  f"({caidas_rapidas} veces seguidas); reintenta en {espera_rec:.0f} s")
                else:
                    print_warning(f"[CONEXIÓN] {uid_str} reconecta (intento {reconnects}): {e}")
                await asyncio.sleep(espera_rec)
            finally:
                _team_active["flag"] = False
                async with _squad["lock"]:
                    _squad["peers"].pop(uid_str, None)
                    escuadra.marcar_desconectado(_squad, uid_str)
                    if _squad["leader_uid"] == uid_str:
                        _squad["leader_uid"] = None
                        _squad["team_code"] = None
                try: await _clear_team_joined(uid_str)
                except Exception: pass
                for tk in (team_coord_task, member_trigger_task, vigilante_task):
                    if tk and not tk.done():
                        tk.cancel()
                        try: await tk
                        except asyncio.CancelledError: pass
                vigilante_task = None
                if gateway_ping_task: gateway_ping_task.cancel()
                if writer:
                    bot_state.unregister_writer(uid_str, writer)
                    await safe_close_writer(writer)
                if not _match_played["flag"]: _team_active["flag"] = True
    except asyncio.CancelledError:
        print_info(f"[CONEXIÓN] Se detuvo el bot {uid_str}")
        raise
    finally:
        for m in play_matches:
            if not m.done(): m.cancel()

# ==================== DATOS DE LA CUENTA ====================
async def informational(addrs, starter_packet, key, iv, region="ID",
                        account_id="", max_reconnects=3, account_data=None):
    uid_str = str(account_id); reconnects = 0
    ip, port = addrs.split(":")
    while True:
        while uid_str and bot_state.is_paused(uid_str):
            await asyncio.sleep(1.0)
        writer = None; ping_task = None
        try:
            resolved_ip = await resolve_host_cloudflare(ip)
            reader, writer = await asyncio.open_connection(resolved_ip, int(port))
            if uid_str: bot_state.register_writer(uid_str, writer)
            raw_sock = writer.get_extra_info('socket')
            if raw_sock: optimize_tcp_socket(raw_sock)
            writer.write(bytes.fromhex(starter_packet)); await writer.drain()
            reconnects = 0
            try:
                init_ka = await send_keep_alive(region)
                if init_ka and not writer.is_closing():
                    writer.write(init_ka)
                    await asyncio.wait_for(writer.drain(), timeout=3)
            except Exception: pass
            async def info_ka():
                ka = await send_keep_alive(region)
                while True:
                    await asyncio.sleep(5)
                    try:
                        if writer and not writer.is_closing():
                            writer.write(ka); await writer.drain()
                    except Exception: break
            ping_task = asyncio.create_task(info_ka())
            print_premium(f"[CUENTA] Conectado: {uid_str} · región {region}",
                          color=PX.SKY, icon=I["dot"])
            while True:
                if uid_str and bot_state.is_paused(uid_str):
                    if ping_task: ping_task.cancel()
                    if uid_str: bot_state.unregister_writer(uid_str, writer)
                    await safe_close_writer(writer); writer = None
                    while bot_state.is_paused(uid_str): await asyncio.sleep(1.0)
                    break
                try: data = await asyncio.wait_for(reader.read(8192), timeout=1.0)
                except asyncio.TimeoutError: continue
                if not data: raise ConnectionError("closed")
        except asyncio.CancelledError:
            if ping_task: ping_task.cancel()
            if uid_str: bot_state.unregister_writer(uid_str, writer)
            await safe_close_writer(writer); raise
        except Exception:
            if ping_task: ping_task.cancel()
            if uid_str: bot_state.unregister_writer(uid_str, writer)
            await safe_close_writer(writer)
            reconnects += 1
            if reconnects > max_reconnects:
                await asyncio.sleep(3); reconnects = 0
            else: await asyncio.sleep(1)

# ==================== AYUDAS DE CUENTAS ====================
def _register_credentials(ad):
    try:
        bot_state.account_credentials[str(ad['account_id'])] = ad
        if ad.get('auth_uid'): bot_state.account_credentials[str(ad['auth_uid'])] = ad
    except Exception: pass

async def refresh_account_profile(ad_or_uid):
    try:
        if isinstance(ad_or_uid, str):
            uid = str(ad_or_uid); ad = bot_state.account_credentials.get(uid)
        else:
            ad = ad_or_uid; uid = str(ad.get('account_id'))
        if not ad: return
        token = ad.get('token'); acc_id = ad.get('account_id')
        srv = ad.get('server_url'); rel = ad.get('release_version')
        if not (token and acc_id and srv and rel): return
        data = await get_player_personal_show(int(acc_id), token, srv, rel)
        if not data: return
        pd = data.get(1, {}) if isinstance(data.get(1), dict) else {}
        nickname = pd.get(3); lvl = pd.get(6); exp = pd.get(7)
        if exp is None: return
        try:
            exp = int(exp); lvl = int(lvl) if lvl else 1
        except Exception: return
        aid = str(acc_id)
        if aid not in bot_state.accounts:
            bot_state.register_account(aid, nickname or f"Player_{aid}",
                region=ad.get('region','BD'), level=lvl, exp=exp,
                auth_uid=ad.get('auth_uid'))
            return
        old = bot_state.accounts[aid].get("current_exp", 0)
        bot_state.update_exp(aid, exp, lvl)
        if nickname: bot_state.accounts[aid]["nickname"] = nickname
        if exp > old:
            print_premium(f"[EXPERIENCIA] +{exp-old:,} para {aid}", color=PX.GOLD, icon=I["spark"])
    except Exception: pass

async def process_account_uid_pass(uid, password, region_override=None):
    cached = cache_get(uid)
    if cached:
        aid = str(cached['account_id'])
        nick = cached.get('nickname', f"Player_{aid}")
        lvl = cached.get('level', 1); expv = cached.get('exp', 0)
        print_premium(f"[CUENTA] En línea: {nick} ({aid}) · región {cached.get('region','BD')}",
                      color=PX.MINT, icon=I["check"])
        bot_state.register_account(aid, nick, cached.get('region','BD'),
            lvl, expv, cached.get('likes',0), auth_uid=str(uid))
        _register_credentials(cached); return cached
    print_info(f"[CUENTA] Entrando con la cuenta {uid}")
    try:
        async with _LOGIN_SEMAPHORE:
            vc = await version_config(region_override or "ID")
            if not vc: return None
            release_version, client_version, server_url, gop_1, app_version = vc
            tg = await get_access_token(uid, password)
            if not tg: return None
            open_id, access_token, platform = tg
            major_payload, login_payload = await get_payload(
                access_token, open_id, platform, client_version)
            res_json = await major_login(major_payload, server_url, release_version)
            if not res_json: return None
            def _gd(k):
                v = res_json.get(str(k))
                if isinstance(v, dict) and "data" in v: return v["data"]
                if k in res_json and not isinstance(res_json[k], dict): return res_json[k]
                if isinstance(v, dict): return v.get("data")
                return None
            acc_id_raw = _gd(1); region_raw = _gd(2) or "ID"
            jwt_token = _gd(8); server_url_raw = _gd(10); server_time = _gd(21)
            aes_ak, iv_i = _extract_key_iv(res_json)
            if not jwt_token or not server_url_raw or not aes_ak: return None
            getlogin_json = await get_login_data(
                login_payload, jwt_token, server_url_raw, release_version)
            if not getlogin_json: return None
        def _gf(f, d=None):
            v = getlogin_json.get(str(f), {}).get("data")
            return v if v is not None else d
        level = int(_gf(6,1) or 1); exp = int(_gf(7,0) or 0)
        likes = int(_gf(8,0) or 0)
        nickname = _gf(4, f"Player_{acc_id_raw}") or f"Player_{acc_id_raw}"
        region = region_raw or _gf(3,"ID") or "ID"
        acc_id = str(acc_id_raw)
        bot_state.register_account(acc_id, nickname, region, level, exp, likes, auth_uid=str(uid))
        print_premium(f"[CUENTA] {nickname} ({acc_id}) · nivel {level} · región {region}",
                      color=PX.GOLD, icon=I["gem"])
        ad = {'account_id':acc_id_raw,'nickname':nickname,'region':region,
            'level':level,'exp':exp,'likes':likes,'open_id':open_id,
            'access_token':access_token,'platform':str(platform),
            'token':jwt_token,'server_time':server_time,
            'aes_ak':aes_ak,'iv_i':iv_i,
            'functional_addrs':_gf(14),'informational_addrs':_gf(32),
            'release_version':release_version,'client_version':client_version,
            'server_url':server_url_raw,'login_payload_data':login_payload,
            'auth_type':'guest','auth_uid':uid,'auth_password':password}
        _register_credentials(ad); cache_set(uid, ad); return ad
    except Exception as e:
        print_error(f"[CUENTA] Error al entrar: {e}"); return None

async def run_account_worker(ad, label, region_override=None, clan_override=None):
    acc_id = str(ad['account_id'])
    info_task = None; exp_task = None
    try:
        reg = region_override or ad.get('region','BD')
        tcp_online = await build_tcp_startup_packet(
            ad['account_id'], ad['token'], ad['server_time'],
            ad['aes_ak'], ad['iv_i'], region=reg, typ='OnLine')
        tcp_chat = await build_tcp_startup_packet(
            ad['account_id'], ad['token'], ad['server_time'],
            ad['aes_ak'], ad['iv_i'], region=reg, typ='ChaT')
        if clan_override:
            try:
                await asyncio.sleep(1.0)
                await join_clan(ad['token'], clan_override)
            except Exception as e: print_warning(f"[CLAN] {e}")
        info_task = asyncio.create_task(informational(
            ad['informational_addrs'], tcp_chat, ad['aes_ak'], ad['iv_i'],
            region=reg, account_id=acc_id, account_data=ad))
        async def exp_refresher():
            while True:
                await asyncio.sleep(90 + random.uniform(-10,10))
                fresh = bot_state.account_credentials.get(acc_id)
                if fresh: await refresh_account_profile(fresh)
        exp_task = asyncio.create_task(exp_refresher())
        await functional_lone_wolf(
            ad['functional_addrs'], tcp_online, reg, ad['client_version'],
            ad['aes_ak'], ad['iv_i'], account_id=acc_id, account_data=ad)
    except asyncio.CancelledError: raise
    except Exception as e:
        print_error(f"[CONEXIÓN] Error del bot {label}: {e}")
    finally:
        for t in (info_task, exp_task):
            if t and not t.done(): t.cancel()
        for t in (info_task, exp_task):
            if t:
                try: await t
                except Exception: pass

async def account_loop_guest(uid, password, region_override=None, clan_override=None):
    uid_str = str(uid)
    bot_state.account_workers[uid_str] = asyncio.current_task()
    acc_id = None
    while True:
        try:
            bot_state.update_status(uid_str, "CONNECTING")
            ad = await process_account_uid_pass(uid_str, password, region_override)
            if not ad:
                print_error(f"[CUENTA] No pudo entrar {uid_str}; reintenta en 15 s"); await asyncio.sleep(15); continue
            acc_id = str(ad['account_id'])
            bot_state.account_workers[acc_id] = asyncio.current_task()
            bot_state.auth_to_game_id[uid_str] = acc_id
            bot_state.game_to_auth_id[acc_id] = uid_str
            await run_account_worker(ad, uid_str, region_override, clan_override)
            await asyncio.sleep(3)
        except asyncio.CancelledError:
            try:
                bot_state.update_status(uid_str, "OFFLINE")
                if acc_id: bot_state.update_status(acc_id, "OFFLINE")
            except Exception: pass
            try:
                await _clear_team_joined(uid_str)
                if acc_id: await _clear_team_joined(acc_id)
            except Exception: pass
            break
        except Exception as e:
            print_error(f"[CONEXIÓN] Error en {uid_str}: {e}"); await asyncio.sleep(10)

# ==================== CREAR CUENTAS ====================
def _gf_field(ld, key, default=None):
    if not ld: return default
    v = ld.get(str(key), {})
    if isinstance(v, dict): return v.get("data", default)
    return v if v is not None else default

async def choose_region(region, jwt_token, login_url, release_version):
    region_code = region.upper()
    url = f"{login_url.rstrip('/')}/ChooseRegion"
    proto = create_proto({1: region_code})
    payload = bytes.fromhex(encrypt_aes(proto.hex()))
    hdrs = {"Accept-Encoding": "gzip", "Authorization": f"Bearer {jwt_token}",
        "Connection": "Keep-Alive",
        "Content-Type": "application/x-www-form-urlencoded",
        "ReleaseVersion": f"{release_version}",
        "User-Agent": "UnityPlayer/2018.4.12f1",
        "X-GA": "v1 1", "X-GA-SV": str(int(time.time())),
        "X-Unity-Version": "2018.4.12f1"}
    try:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
            async with s.post(url, data=payload, headers=hdrs, ssl=ssl_ctx) as r:
                print_info(f"[REGIÓN] Eligiendo {region} → HTTP {r.status}")
                return r.status
    except Exception as e:
        print_error(f"[REGIÓN] {e}"); return None

async def major_register(release_v, access_token, open_id, name, game_version,
                          login_url, lang_code="en"):
    try:
        field14 = bytes(ord(c) ^ KEYSTREAM[i % 32] for i, c in enumerate(open_id))
        fields = {1: name, 2: access_token, 3: open_id, 5: 102000007,
                  6: 4, 7: 1, 13: 1, 14: field14, 15: lang_code,
                  16: 2, 20: game_version, 21: 1, 22: GGRE_RAW}
        proto = _encode_proto_std(fields)
        payload = AES.new(AES_KEY, AES.MODE_CBC, AES_IV).encrypt(pad(proto, 16))
        url = f"{login_url.rstrip('/')}/MajorRegister"
        hdrs = {
            "Accept": "*/*", "Authorization": "Bearer ",
            "Content-Type": "application/x-www-form-urlencoded",
            "ReleaseVersion": f"{release_v}",
            "User-Agent": "UnityPlayer/2018.4.12f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
            "X-GA": "v1 1", "X-GA-SV": str(int(time.time())),
            "X-Unity-Version": "2018.4.12f1",
        }
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False; ssl_ctx.verify_mode = ssl.CERT_NONE
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
            async with s.post(url, headers=hdrs, data=payload, ssl=ssl_ctx) as resp:
                content = await resp.read()
                print_info(f"[REGISTRO] El juego respondió {resp.status} "
                           f"({len(content)} bytes) · versión {game_version}")
                if resp.status != 200 or not content: return None
                for off in [0,64,48,32,80,16,8,96,128]:
                    if off >= len(content): continue
                    try:
                        r = decode_protobuf_2(content[off:])
                        if r and 3 in r:
                            return {str(k): {"data": v} for k, v in r.items()}
                    except Exception: pass
                if len(content) % 16 == 0:
                    try:
                        pt = AES.new(AES_KEY, AES.MODE_CBC, AES_IV).decrypt(content)
                        pad_len = pt[-1]
                        if 1 <= pad_len <= 16 and all(b == pad_len for b in pt[-pad_len:]):
                            pt = pt[:-pad_len]
                        r = decode_protobuf_2(pt)
                        if r and 3 in r:
                            return {str(k): {"data": v} for k, v in r.items()}
                    except Exception: pass
                return None
    except Exception as e:
        print_error(f"[REGISTRO] {e}"); return None

def _proxima_escuadra_libre():
    """El nombre de la siguiente escuadra que no existe todavía (E1, E2, E3...)."""
    usadas = set(_escuadras_del_archivo()) | set(_squads)
    i = 1
    while f"E{i}" in usadas:
        i += 1
    return f"E{i}"


async def create_four_accounts(region: str, clan_id: str, count: int = 4, password: str = "RAFIN",
                               squad: str = None, reset_progreso: bool = True):
    bot_state.creating = True
    if reset_progreso:
        bot_state.create_progress = []
    def _prog(s):
        try:
            print_premium(s, color=PX.VIOLET, icon=I["bolt"], tag="CREAR")
        except Exception: pass
        bot_state.create_progress.append(s)
    destino = str(squad).strip() if squad else _proxima_escuadra_libre()
    try:
        print_rule(f"⚡ CREANDO {count} BOTS · {_etiqueta_escuadra(destino).upper()} · REGIÓN {region}",
                   color=PX.MAGENTA)
        _prog(f"Van para la {_etiqueta_escuadra(destino).lower()}")
        _prog(f"Buscando la versión del juego para {region}...")
        vc = await version_config(region)
        if not vc:
            _prog("No se pudo leer la versión del juego"); return []
        release_v, remote_v, login_url, gop_1, app_version = vc
        if not login_url.endswith("/"): login_url += "/"
        lang = REGION_LANG.get(region.upper(), "en")
        game_version = remote_v or app_version
        _prog(f"Versión lista | app {release_v} | juego {game_version}")
        created = []
        for i in range(count):
            _prog(f"Creando bot {i+1} de {count}...")
            try:
                # Garena a veces rechaza si se piden muchas cuentas seguidas: se reintenta con pausa
                uid = None
                for intento in range(CREATE_RETRIES):
                    uid = await register_account(password, gop_1, app_version)
                    if uid:
                        break
                    if intento + 1 < CREATE_RETRIES:
                        _prog(f"bot {i+1}: Garena no dejó registrar, reintento en "
                              f"{CREATE_RETRY_WAIT:.0f} s ({intento+2}/{CREATE_RETRIES})")
                        await asyncio.sleep(CREATE_RETRY_WAIT)
                if not uid:
                    _prog(f"bot {i+1}: no se pudo registrar la cuenta"); continue
                tok = None
                for intento in range(CREATE_RETRIES):
                    tok = await grant_token(uid, password, gop_1, app_version)
                    if tok:
                        break
                    if intento + 1 < CREATE_RETRIES:
                        await asyncio.sleep(CREATE_RETRY_WAIT)
                if not tok:
                    _prog(f"bot {i+1}: no se pudo obtener el permiso"); continue
                open_id = tok["open_id"]; access_token = tok["access_token"]
                platform = tok.get("platform", 4)
                major_payload, login_payload = await get_payload(
                    access_token, open_id, platform, game_version, lang)
                nickname_final = _nuevo_apodo()
                mr = None
                for intento in range(CREATE_RETRIES):
                    mr = await major_register(release_v, access_token, open_id,
                                              nickname_final, game_version, login_url, lang)
                    if mr:
                        break
                    if intento + 1 < CREATE_RETRIES:
                        _prog(f"bot {i+1}: el juego no aceptó el registro, reintento en "
                              f"{CREATE_RETRY_WAIT:.0f} s ({intento+2}/{CREATE_RETRIES})")
                        await asyncio.sleep(CREATE_RETRY_WAIT)
                if not mr:
                    _prog(f"bot {i+1}: falló el registro en el juego"); continue
                await asyncio.sleep(3.0)
                res_json = None
                for attempt in range(3):
                    mp, lp = await get_payload(
                        access_token, open_id, platform, game_version, lang)
                    res_json = await major_login(mp, login_url, release_v)
                    if res_json and (("8" in res_json) or (8 in res_json)):
                        login_payload = lp; break
                    res_json = None
                    await asyncio.sleep(2.0)
                if not res_json:
                    _prog(f"bot {i+1}: no pudo entrar al juego (1)"); continue
                def _gd(k):
                    v = res_json.get(str(k))
                    if isinstance(v, dict) and "data" in v: return v["data"]
                    if k in res_json and not isinstance(res_json[k], dict): return res_json[k]
                    if isinstance(v, dict): return v.get("data")
                    return None
                jwt_token = _gd(8); server_url_raw = _gd(10)
                server_time = _gd(21); acc_id_raw = _gd(1)
                if not jwt_token:
                    _prog(f"bot {i+1}: el juego no dio la sesión"); continue
                if not server_url_raw:
                    _prog(f"   → Eligiendo la región {region}...")
                    cr_status = await choose_region(region, jwt_token, login_url, release_v)
                    if cr_status != 200:
                        _prog(f"bot {i+1}: no se pudo elegir la región"); continue
                    await asyncio.sleep(2.0)
                    res_json2 = None
                    for attempt in range(3):
                        mp2, lp2 = await get_payload(
                            access_token, open_id, platform, game_version, lang)
                        res_json2 = await major_login(mp2, login_url, release_v)
                        if res_json2 and (("10" in res_json2) or (10 in res_json2)):
                            res_json = res_json2; login_payload = lp2; break
                        res_json2 = None
                        await asyncio.sleep(2.0)
                    if not res_json2:
                        _prog(f"bot {i+1}: no pudo entrar al juego (2)"); continue
                    res_json = res_json2
                    jwt_token = _gd(8); server_url_raw = _gd(10)
                    server_time = _gd(21); acc_id_raw = _gd(1)
                aes_ak, iv_i = _extract_key_iv(res_json)
                if not aes_ak or not iv_i:
                    _prog(f"bot {i+1}: el juego no dio las claves"); continue
                ld = await get_login_data(login_payload, jwt_token, server_url_raw, release_v)
                level, exp, likes = 1, 0, 0
                if ld:
                    def _gf(f, d=None):
                        v = ld.get(str(f), {}).get("data")
                        return v if v is not None else d
                    level = int(_gf(6, 1) or 1)
                    exp = int(_gf(7, 0) or 0)
                    likes = int(_gf(8, 0) or 0)
                    nickname_final = _gf(4, nickname_final) or nickname_final
                ad = {
                    'account_id': acc_id_raw, 'nickname': nickname_final,
                    'region': region, 'level': level, 'exp': exp, 'likes': likes,
                    'open_id': open_id, 'access_token': access_token,
                    'platform': str(platform), 'token': jwt_token,
                    'server_time': server_time, 'aes_ak': aes_ak, 'iv_i': iv_i,
                    'functional_addrs': _gf_field(ld, 14),
                    'informational_addrs': _gf_field(ld, 32),
                    'release_version': release_v, 'client_version': game_version,
                    'server_url': server_url_raw, 'login_payload_data': login_payload,
                    'auth_type': 'guest', 'auth_uid': uid, 'auth_password': password,
                }
                _register_credentials(ad); cache_set(uid, ad)
                created.append(ad)
                _prog(f"bot {i+1}: {nickname_final} · ID {acc_id_raw} · región {region}")
                await asyncio.sleep(0.6)
            except Exception as e:
                _prog(f"bot {i+1}: {e}")
                traceback.print_exc()
        if created:
            try:
                existing = []
                if os.path.exists(ACCOUNTS_FILE):
                    try:
                        with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                            existing = json.load(f) or []
                            if not isinstance(existing, list): existing = []
                    except Exception: existing = []
                existing_uids = {str(a.get("uid")) for a in existing if isinstance(a, dict)}
                for a in created:
                    u = str(a['auth_uid'])
                    if u not in existing_uids:
                        existing.append({"uid": u, "password": a['auth_password'],
                                         "region": region, "clan_id": clan_id,
                                         "squad": destino})
                with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
                    json.dump(existing, f, indent=2)
                _prog(f"Se guardaron {len(created)} cuentas")
            except Exception as e:
                _prog(f"No se pudieron guardar las cuentas: {e}")
        if created:
            _prog(f"Encendiendo {len(created)} bots...")
            for i, a in enumerate(created):
                try:
                    task = asyncio.create_task(account_loop_guest(
                        str(a['auth_uid']), a['auth_password'],
                        region_override=region, clan_override=clan_id))
                    bot_state.account_workers[str(a['auth_uid'])] = task
                    _prog(f"   → bot {i+1} de {len(created)} encendido")
                    await asyncio.sleep(0.35)
                except Exception as e:
                    _prog(f"   bot {i+1}: {e}")
            _prog(f"Los {len(created)} bots ya están encendidos.")
        else:
            _prog("No se creó ninguna cuenta.")
        return created
    except Exception as e:
        _prog(f"Error creando las cuentas: {e}")
        traceback.print_exc(); return []
    finally:
        bot_state.creating = False
        print_rule(color=PX.MAGENTA)

# ==================== CARGA AUTOMÁTICA ====================
async def _autoload_accounts():
    if not os.path.exists(ACCOUNTS_FILE):
        print_info("[INICIO] Todavía no hay accounts.json"); return
    try:
        with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
            accounts = json.load(f) or []
    except Exception as e:
        print_error(f"[INICIO] No se pudo leer accounts.json: {e}"); return
    if not isinstance(accounts, list) or not accounts:
        print_info("[INICIO] accounts.json está vacío"); return
    _fijar_escuadras_en_archivo()
    for nombre, miembros in _escuadras_del_archivo().items():
        print_info(f"[ESCUADRAS] {_etiqueta_escuadra(nombre)}: {len(miembros)} bot(s)")
    print_premium(f"[INICIO] Cargando {len(accounts)} cuenta(s) guardadas",
                  color=PX.GOLD, icon=I["star"], tag="INICIO")
    for i, a in enumerate(accounts):
        try:
            if not isinstance(a, dict): continue
            uid = str(a.get("uid", "")).strip()
            password = str(a.get("password", "")).strip()
            region = str(a.get("region", "")).strip() or None
            clan_id = str(a.get("clan_id", "")).strip() or CLAN_ID_DEFAULT
            if not uid or not password: continue
            task = asyncio.create_task(account_loop_guest(
                uid, password, region_override=region, clan_override=clan_id))
            bot_state.account_workers[uid] = task
            print_info(f"[INICIO] Encendiendo {uid} ({i+1}/{len(accounts)}) · región {region}")
            await asyncio.sleep(0.5)
        except Exception as e:
            print_error(f"[INICIO] bot {i+1}: {e}")

# ==================== SERVIDOR WEB ====================
@aiohttp.web.middleware
async def _req_logger(request, handler):
    print(f"{PX.SLATE}[REQ]{PX.RESET} {PX.BOLD}{request.method}{PX.RESET} {PX.SKY}{request.path}{PX.RESET}")
    try:
        resp = await handler(request)
        print(f"{PX.SLATE}[RES]{PX.RESET} {PX.BOLD}{request.method}{PX.RESET} {PX.SKY}{request.path}{PX.RESET} {PX.DIM}→{PX.RESET} {PX.EMERALD}{resp.status}{PX.RESET}")
        return resp
    except aiohttp.web.HTTPException as e:
        if request.path.startswith("/api/"):
            return aiohttp.web.json_response(
                {"ok": False, "status": "error", "error": e.reason or str(e)},
                status=e.status)
        raise
    except Exception as e:
        traceback.print_exc()
        if request.path.startswith("/api/"):
            return aiohttp.web.json_response(
                {"ok": False, "status": "error", "error": str(e)}, status=500)
        raise

async def serve_index(request):
    for path in (INDEX_HTML_PATH, "index.html"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return aiohttp.web.Response(text=f.read(), content_type="text/html")
        except Exception: continue
    return aiohttp.web.Response(text="<h1>GUILD GLORY BOT</h1><p>No se encontró la página.</p>", content_type="text/html")

def _fase_para_panel(st, bots):
    peers = st.get("peers") or {}
    if any("IN_MATCH" in str(b.get("status", "")).upper() for b in bots):
        return "en_partida"
    if not peers:
        return "sin_conectar"
    lid = st.get("leader_uid")
    if not lid or lid not in peers:
        return "sin_lider"
    return st.get("fase") or "esperando"


# ==================== CLANES (agrupar escuadras en el panel) ====================
CLANES_FILE = "clanes.json"


def _clanes_cargar():
    """{"nombres": {id: nombre}, "ultimo": id del último clan usado al crear}."""
    try:
        if os.path.exists(CLANES_FILE):
            with open(CLANES_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                if not isinstance(d.get("nombres"), dict):
                    d["nombres"] = {}
                d["ultimo"] = str(d.get("ultimo") or "")
                return d
    except Exception as e:
        print_warning(f"[CLANES] No se pudo leer {CLANES_FILE}: {e}")
    return {"nombres": {}, "ultimo": ""}


def _clanes_guardar(d):
    try:
        tmp = CLANES_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CLANES_FILE)
        return True
    except Exception as e:
        print_warning(f"[CLANES] No se pudo guardar {CLANES_FILE}: {e}")
        return False


_clan_cache = {"mtime": None, "mapa": {}}


def _clan_de_cuentas():
    """{uid de la cuenta: id del clan} según accounts.json (se relee solo si cambió)."""
    try:
        mt = os.path.getmtime(ACCOUNTS_FILE) if os.path.exists(ACCOUNTS_FILE) else None
        if mt != _clan_cache["mtime"]:
            _clan_cache["mapa"] = {str(a.get("uid")): str(a.get("clan_id") or "").strip()
                                   for a in _leer_cuentas() if a.get("uid")}
            _clan_cache["mtime"] = mt
    except Exception:
        pass
    return _clan_cache["mapa"]


def _clan_de_escuadra(auths, mapa):
    cuenta = {}
    for a in auths:
        c = mapa.get(str(a)) or ""
        if c:
            cuenta[c] = cuenta.get(c, 0) + 1
    return max(cuenta, key=cuenta.get) if cuenta else ""


def _escuadras_snapshot():
    """Arma la lista de escuadras para el panel y cómo va cada una."""
    grupos = _escuadras_del_archivo()
    # escuadras que existen en vivo pero todavía no en el archivo
    for nombre in _squads:
        grupos.setdefault(nombre, [])
    ahora = time.time()
    salida = []
    mapa_clan = _clan_de_cuentas()
    nombres_clan = _clanes_cargar().get("nombres") or {}
    for nombre in sorted(grupos, key=_clave_orden_escuadra):
        auths = grupos[nombre]
        st = _squads.get(nombre) or {}
        lider = str(st.get("leader_uid") or "")
        bots = []
        for auth in auths:
            gid = str(bot_state.auth_to_game_id.get(auth, auth))
            acc = bot_state.accounts.get(gid) or bot_state.accounts.get(auth) or {}
            bots.append({
                "uid": acc.get("uid") or gid,
                "auth_uid": auth,
                "nickname": acc.get("nickname") or "",
                "status": acc.get("status") or "OFFLINE",
                "is_paused": bool(acc.get("is_paused")),
                "level": acc.get("level") or 0,
                "matches": acc.get("matches") or 0,
                "gained_exp": acc.get("gained_exp") or 0,
                "es_lider": bool(lider) and str(acc.get("uid") or gid) == lider,
            })
        falta = max(0, TEAM_SIZE - len(auths))
        espera = float(st.get("esperar_hasta") or 0)
        try:
            num = int(nombre[1:]) if nombre.startswith("E") and nombre[1:].isdigit() else 0
        except Exception:
            num = 0
        salida.append({
            "nombre": nombre,
            "num": num,
            "titulo": _etiqueta_escuadra(nombre),
            "esperados": len(auths) or TEAM_SIZE,
            "conectados": len(st.get("peers") or {}),
            "lugares_libres": falta,
            "team_code": st.get("team_code"),
            "leader_uid": lider,
            "lider_listo": bool(lider and (st.get("peers") or {}).get(lider)),
            "fase": _fase_para_panel(st, bots),
            "fase_desde": float(st.get("fase_desde") or 0),
            "esperar_hasta": espera if espera > ahora else 0,
            "esperar_pendiente": bool(st.get("esperar_pendiente")),
            "invitar_uid": st.get("invitar_uid") or "",
            "clan_id": _clan_de_escuadra(auths, mapa_clan),
            "bots": bots,
        })
    for e in salida:
        e["clan_nombre"] = str(nombres_clan.get(e["clan_id"]) or "")
    return salida


async def api_ping(request):
    return aiohttp.web.json_response({"pong": True, "app": "GUILD GLORY BOT", "version": "2.0"})

async def api_stats(request):
    try:
        accs = list(bot_state.accounts.values())
        online = sum(1 for a in accs if a.get("status") in ("ONLINE","IN_MATCH","SEARCHING"))
        active_matches = sum(a.get("active_matches", 0) for a in accs)
        uptime = max(1, int(time.time() - bot_state.start_time))
        uptime_h = max(0.016, uptime / 3600.0)
        exp_rate = int(bot_state.total_exp_gained / uptime_h) if uptime_h > 0 else 0
        matches_rate = int(bot_state.matches_started / uptime_h) if uptime_h > 0 else 0
        logs_out = []
        for l in bot_state.logs[-200:]:
            try:
                logs_out.append({"time": str(l.get("time","")),
                                 "message": str(l.get("message","")),
                                 "level": str(l.get("level","info"))})
            except Exception: continue
        data = {
            "accounts": accs, "logs": logs_out,
            "total_accounts": len(accs), "total_online": online,
            "total_matches": bot_state.total_matches,
            "total_matches_started": bot_state.matches_started,
            "total_active_matches": active_matches,
            "total_gained_exp": bot_state.total_exp_gained,
            "uptime": uptime, "exp_per_hour": exp_rate,
            "matches_per_hour": matches_rate,
            "creating": bool(bot_state.creating),
            "create_progress": [str(x) for x in bot_state.create_progress[-40:]],
            "escuadras": _escuadras_snapshot(),
            "clanes": _clanes_cargar(),
            "sistema": sistema.ultimo(),
            "restart_finished": len(_restart_state["finished_bots"]),
            "restart_target": _restart_state["target"],
            "restarting": _restart_state["restarting"],
        }
        return aiohttp.web.Response(text=json.dumps(data, default=str, ensure_ascii=False),
                                    content_type="application/json", charset="utf-8")
    except Exception as e:
        traceback.print_exc()
        return aiohttp.web.Response(text=json.dumps({"error": str(e), "accounts": [],
            "logs": [], "create_progress": [], "creating": False,
            "total_accounts": 0, "total_matches_started": 0, "total_matches": 0,
            "total_active_matches": 0, "total_gained_exp": 0, "uptime": 1,
            "exp_per_hour": 0}), content_type="application/json", charset="utf-8")

async def api_state(request):
    try:
        return aiohttp.web.Response(text=json.dumps({
            "creating": bool(bot_state.creating),
            "create_progress": [str(x) for x in bot_state.create_progress[-40:]],
            "accounts": list(bot_state.accounts.values()),
            "escuadras": _escuadras_snapshot(),
        }, default=str, ensure_ascii=False), content_type="application/json", charset="utf-8")
    except Exception as e:
        return aiohttp.web.Response(text=json.dumps({"error": str(e), "creating": False,
                                    "create_progress": []}),
                                    content_type="application/json", charset="utf-8")

async def api_progress(request):
    try:
        lines = [str(x) for x in bot_state.create_progress[-60:]]
        text = '{"creating":' + ("true" if bot_state.creating else "false") + \
               ',"create_progress":' + json.dumps(lines) + '}'
        return aiohttp.web.Response(text=text, content_type="application/json")
    except Exception:
        return aiohttp.web.Response(text='{"creating":false,"create_progress":[]}',
                                    content_type="application/json")

async def api_create_team(request):
    try:
        body = await request.json()
        region = str(body.get("region", "ID")).upper()
        clan_id = str(body.get("clan_id", "")).strip()
        count = int(body.get("count", 4))
        password = str(body.get("password", "RAFIN")).strip() or "RAFIN"
        if not clan_id:
            return aiohttp.web.json_response({"ok": False, "error": "Falta el ID del clan"})
        try:
            _cc = _clanes_cargar(); _cc["ultimo"] = clan_id; _clanes_guardar(_cc)
        except Exception:
            pass
        if bot_state.creating:
            return aiohttp.web.json_response({"ok": False, "error": "Ya se están creando cuentas, espera a que termine"})
        count = max(1, min(4, count))
        try:
            escuadras = int(body.get("squads", 1))
        except Exception:
            escuadras = 1
        escuadras = max(1, min(MAX_ESCUADRAS_POR_VEZ, escuadras))
        bot_state.creating = True
        asyncio.create_task(_crear_varias_escuadras(region, clan_id, count, password, escuadras))
        total = escuadras * count
        txt = (f"Creando {escuadras} escuadras de {count} ({total} bots)" if escuadras > 1
               else f"Creando {count} bot(s)")
        return aiohttp.web.json_response({"ok": True, "msg": txt})
    except Exception as e:
        traceback.print_exc()
        return aiohttp.web.json_response({"ok": False, "error": str(e)})

MAX_ESCUADRAS_POR_VEZ = 10


async def _crear_varias_escuadras(region, clan_id, count, password, escuadras):
    """Crea varias escuadras una tras otra. Si una no logra crear ningún bot, para
    (seguramente Garena está rechazando y seguir solo haría perder tiempo)."""
    bot_state.create_progress = []
    hechas = 0
    try:
        for n in range(escuadras):
            if escuadras > 1:
                bot_state.create_progress.append(f"══ Escuadra nueva {n + 1} de {escuadras} ══")
            creados = await create_four_accounts(region, clan_id, count, password,
                                                 reset_progreso=False)
            bot_state.creating = True   # sigue "creando" hasta terminar todas
            if not creados:
                if n + 1 < escuadras:
                    bot_state.create_progress.append(
                        "No se pudo crear ningún bot en esta escuadra; se para aquí. "
                        "Espera un rato y vuelve a intentar.")
                break
            hechas += 1
            if n + 1 < escuadras:
                await asyncio.sleep(3.0)
        if escuadras > 1:
            bot_state.create_progress.append(f"Listo: {hechas} de {escuadras} escuadras creadas.")
            print_info(f"[ESCUADRAS] Se crearon {hechas} de {escuadras} escuadras")
    except Exception as e:
        bot_state.create_progress.append(f"Error creando las escuadras: {e}")
    finally:
        bot_state.creating = False


async def api_squad_add_bot(request):
    """Crea 1 bot nuevo y lo mete en esa escuadra (para completarla a 4)."""
    try:
        body = await request.json()
        nombre = str(body.get("squad", "")).strip()
        grupos = _escuadras_del_archivo()
        if nombre not in grupos:
            return aiohttp.web.json_response({"ok": False, "error": "No encontré esa escuadra"})
        if len(grupos[nombre]) >= TEAM_SIZE:
            return aiohttp.web.json_response({"ok": False, "error": f"Esa escuadra ya tiene {TEAM_SIZE} bots"})
        if bot_state.creating:
            return aiohttp.web.json_response({"ok": False, "error": "Ya se están creando cuentas, espera a que termine"})
        # Usa la región y el clan de los bots que ya están en esa escuadra
        region, clan_id, clave = "US", CLAN_ID_DEFAULT, "BYTRXXX"
        for a in _leer_cuentas():
            if str(a.get("uid")) in grupos[nombre]:
                region = str(a.get("region") or region).upper()
                clan_id = str(a.get("clan_id") or clan_id)
                clave = str(a.get("password") or clave)
                break
        asyncio.create_task(create_four_accounts(region, clan_id, 1, clave, squad=nombre))
        return aiohttp.web.json_response(
            {"ok": True, "msg": f"Creando 1 bot para la {_etiqueta_escuadra(nombre).lower()}"})
    except Exception as e:
        bot_state.creating = False
        return aiohttp.web.json_response({"ok": False, "error": str(e)})


def _lider_de(st):
    """Devuelve los datos del líder de esa escuadra si está conectado."""
    lid = st.get("leader_uid")
    p = (st.get("peers") or {}).get(lid) if lid else None
    if not p:
        return None, None
    w = p.get("writer")
    if w is None or w.is_closing():
        return None, None
    return lid, p


def _alguien_en_partida(st):
    for uid in (st.get("peers") or {}):
        a = bot_state.accounts.get(str(uid)) or {}
        if "IN_MATCH" in str(a.get("status", "")).upper():
            return True
    return False


async def api_squad_invite_player(request):
    """El líder de la escuadra invita a tu cuenta de Free Fire."""
    try:
        body = await request.json()
        nombre = str(body.get("squad", "")).strip()
        uid = str(body.get("uid", "")).strip()
        if nombre not in _squads and nombre not in _escuadras_del_archivo():
            return aiohttp.web.json_response({"ok": False, "error": "No encontré esa escuadra"})
        if not uid.isdigit() or not (6 <= len(uid) <= 15):
            return aiohttp.web.json_response({"ok": False, "error": "Escribe tu ID de Free Fire (solo números)"})
        st = _estado_por_nombre(nombre)
        etiqueta = _etiqueta_escuadra(nombre)
        st["invitar_uid"] = uid
        if _alguien_en_partida(st):
            # En partida no se puede invitar: se guarda y al terminar te invitan y te esperan
            st["esperar_min"] = 5.0
            st["esperar_pendiente"] = True
            print_info(f"[EQUIPO] {etiqueta}: al terminar esta partida el líder te invitará ({uid}) "
                       f"y te esperarán 5 min")
            return aiohttp.web.json_response(
                {"ok": True, "msg": "Están en partida. Cuando terminen, el líder te invita y te esperan 5 min."})
        lid, p = _lider_de(st)
        if not lid:
            return aiohttp.web.json_response(
                {"ok": False, "error": "El líder no está conectado todavía. Espera a que arme su equipo."})
        st["esperar_hasta"] = max(float(st.get("esperar_hasta") or 0), time.time() + 120)
        enviado = False
        for _ in range(2):
            try:
                pkt = invite_player_in_team(int(uid), p["key"], p["iv"],
                                            region=p.get("region") or "US")
                w = p.get("writer")
                if w and not w.is_closing():
                    w.write(pkt); await w.drain(); enviado = True
            except Exception as e:
                print_warning(f"[EQUIPO] {etiqueta}: error al invitarte: {e}")
            await asyncio.sleep(0.6)
        if not enviado:
            return aiohttp.web.json_response({"ok": False, "error": "No se pudo mandar la invitación"})
        print_info(f"[EQUIPO] {etiqueta}: te invitó ({uid}); acepta en el juego")
        return aiohttp.web.json_response({"ok": True, "msg": "Acepta la invitación en el juego. Te esperan 2 min."})
    except Exception as e:
        return aiohttp.web.json_response({"ok": False, "error": str(e)})


async def api_squad_hold(request):
    """Que la escuadra no busque partida unos minutos, para que entres tú (0 = seguir)."""
    try:
        body = await request.json()
        nombre = str(body.get("squad", "")).strip()
        if nombre not in _squads and nombre not in _escuadras_del_archivo():
            return aiohttp.web.json_response({"ok": False, "error": "No encontré esa escuadra"})
        try:
            minutos = float(body.get("minutes", 5))
        except Exception:
            minutos = 5.0
        minutos = max(0.0, min(minutos, 10.0))
        st = _estado_por_nombre(nombre)
        etiqueta = _etiqueta_escuadra(nombre)
        if minutos <= 0:
            st["esperar_hasta"] = 0
            st["esperar_pendiente"] = False
            st["invitar_uid"] = None
            print_info(f"[EQUIPO] {etiqueta}: ya no te espera, vuelve a buscar partida")
            return aiohttp.web.json_response({"ok": True, "msg": f"{etiqueta} vuelve a buscar partida"})
        st["esperar_min"] = minutos
        if _alguien_en_partida(st):
            st["esperar_pendiente"] = True
            print_info(f"[EQUIPO] {etiqueta}: al terminar esta partida te esperará {minutos:g} min")
            return aiohttp.web.json_response(
                {"ok": True, "msg": f"Cuando terminen esta partida, te esperan {minutos:g} min"})
        st["esperar_pendiente"] = False
        st["esperar_hasta"] = time.time() + minutos * 60
        print_info(f"[EQUIPO] {etiqueta}: te espera {minutos:g} min para que entres al equipo")
        return aiohttp.web.json_response({"ok": True, "msg": f"{etiqueta} te espera {minutos:g} min"})
    except Exception as e:
        return aiohttp.web.json_response({"ok": False, "error": str(e)})


async def api_account_add(request):
    try:
        body = await request.json()
        if body.get("token"):
            token = str(body["token"]).strip()
            if not token:
                return aiohttp.web.json_response({"status": "error", "error": "El token está vacío"})
            asyncio.create_task(account_loop_token(token))
            return aiohttp.web.json_response({"status": "ok"})
        uid = str(body.get("uid", "")).strip()
        password = str(body.get("password", "")).strip()
        if not uid or not password:
            return aiohttp.web.json_response({"status": "error", "error": "Faltan el ID y la contraseña"})
        asyncio.create_task(account_loop_guest(uid, password))
        return aiohttp.web.json_response({"status": "ok"})
    except Exception as e:
        return aiohttp.web.json_response({"status": "error", "error": str(e)})

async def api_account_delete(request):
    try:
        body = await request.json()
        uid = str(body.get("uid", "")).strip()
        auth_uid = str(body.get("auth_uid", "")).strip()
        for u in {uid, auth_uid} - {""}:
            if u in bot_state.account_workers:
                try: bot_state.account_workers[u].cancel()
                except Exception: pass
                bot_state.account_workers.pop(u, None)
            if u in bot_state.accounts: del bot_state.accounts[u]
            cache_invalidate(u)
            bot_state.toggle_pause(u, False)
        return aiohttp.web.json_response({"status": "ok"})
    except Exception as e:
        return aiohttp.web.json_response({"status": "error", "error": str(e)})

async def api_account_refresh(request):
    try:
        body = await request.json()
        uid = str(body.get("uid", "")).strip()
        asyncio.create_task(refresh_account_profile(uid))
        return aiohttp.web.json_response({"status": "ok"})
    except Exception as e:
        return aiohttp.web.json_response({"status": "error", "error": str(e)})

async def api_account_restart(request):
    try:
        body = await request.json()
        uid = str(body.get("uid", "")).strip()
        resolved = {uid}
        if uid in bot_state.game_to_auth_id: resolved.add(str(bot_state.game_to_auth_id[uid]))
        if uid in bot_state.auth_to_game_id: resolved.add(str(bot_state.auth_to_game_id[uid]))
        for u in resolved:
            if u in bot_state.account_workers:
                try: bot_state.account_workers[u].cancel()
                except Exception: pass
                bot_state.account_workers.pop(u, None)
        try:
            if os.path.exists(ACCOUNTS_FILE):
                with open(ACCOUNTS_FILE,"r",encoding="utf-8") as f:
                    accs = json.load(f)
                for a in accs:
                    if str(a.get("uid")) in resolved and a.get("password"):
                        t = asyncio.create_task(account_loop_guest(str(a["uid"]), a["password"]))
                        bot_state.account_workers[str(a["uid"])] = t
                        break
        except Exception: pass
        return aiohttp.web.json_response({"status": "ok"})
    except Exception as e:
        return aiohttp.web.json_response({"status": "error", "error": str(e)})

async def api_account_pause(request):
    try:
        body = await request.json()
        uid = str(body.get("uid", "")).strip()
        new_state = not bot_state.is_paused(uid)
        bot_state.toggle_pause(uid, new_state)
        if new_state: bot_state.close_writers_for_account(uid)
        return aiohttp.web.json_response({"status": "ok", "is_paused": new_state})
    except Exception as e:
        return aiohttp.web.json_response({"status": "error", "error": str(e)})

async def api_account_pause_all(request):
    try:
        accs = list(bot_state.accounts.keys())
        if not accs:
            return aiohttp.web.json_response({"status": "ok", "all_paused": False})
        all_paused = all(bot_state.is_paused(u) for u in accs)
        new_state = not all_paused
        for u in accs:
            bot_state.toggle_pause(u, new_state)
            if new_state: bot_state.close_writers_for_account(u)
        return aiohttp.web.json_response({"status": "ok", "all_paused": new_state})
    except Exception as e:
        return aiohttp.web.json_response({"status": "error", "error": str(e)})

async def api_sistema(request):
    try:
        return aiohttp.web.json_response(sistema.ultimo(), dumps=lambda o: json.dumps(o, default=str))
    except Exception as e:
        return aiohttp.web.json_response({"error": str(e)})

async def api_clan_nombre(request):
    """Ponerle nombre a un clan (para reconocerlo en el panel)."""
    try:
        d = await request.json()
        cid = "".join(ch for ch in str(d.get("id") or "") if ch.isdigit())
        nombre = str(d.get("nombre") or "").strip()[:30]
        if not cid:
            return aiohttp.web.json_response({"ok": False, "error": "Falta el ID del clan"})
        cfg = _clanes_cargar()
        if nombre:
            cfg["nombres"][cid] = nombre
        else:
            cfg["nombres"].pop(cid, None)
        _clanes_guardar(cfg)
        return aiohttp.web.json_response({"ok": True, "msg": "Nombre guardado"})
    except Exception as e:
        return aiohttp.web.json_response({"ok": False, "error": str(e)})

async def api_clan_rot_get(request):
    cfg = rotacion_cargar()
    ahora = _rot_ahora(cfg)
    cfg["ahora"] = ahora.strftime("%Y-%m-%dT%H:%M")
    cfg["bots"] = len({str((a or {}).get("account_id") or u)
                       for u, a in list(bot_state.account_credentials.items())})
    cfg["salida_ok"] = _clan_salida_ok["ruta"] or ""
    cfg["salida_imposible"] = bool(_clan_salida_ok["imposible"])
    return aiohttp.web.json_response(cfg)

async def api_clan_rot_set(request):
    try:
        d = await request.json()
        cfg = rotacion_cargar()
        for campo_id in ("clan_id", "clan_actual"):
            if campo_id in d:
                cfg[campo_id] = "".join(ch for ch in str(d.get(campo_id) or "") if ch.isdigit())
        for campo in ("salida", "entrada"):
            if campo in d:
                f = _rot_fecha(d.get(campo))
                cfg[campo] = _rot_texto(f) if f else ""
        if "huso" in d:
            try: cfg["huso"] = max(-12.0, min(14.0, float(d.get("huso"))))
            except Exception: pass
        if "repetir_dias" in d:
            try: cfg["repetir_dias"] = max(0, min(365, int(d.get("repetir_dias") or 0)))
            except Exception: pass
        if "activo" in d:
            cfg["activo"] = bool(d.get("activo"))
        # Si cambian las fechas, el cambio vuelve a quedar pendiente
        if any(k in d for k in ("salida", "entrada", "activo", "clan_id")):
            cfg["hecho_salida"] = False; cfg["hecho_entrada"] = False
        if not rotacion_guardar(cfg):
            return aiohttp.web.json_response({"ok": False, "error": "No se pudo guardar"})
        return aiohttp.web.json_response({"ok": True, "cfg": cfg})
    except Exception as e:
        return aiohttp.web.json_response({"ok": False, "error": str(e)})

async def api_clan_rot_ajustar(request):
    """Suma o resta días a las dos fechas de una (los botones +1 semana, -1 día...)."""
    from datetime import timedelta
    try:
        d = await request.json()
        dias = float(d.get("dias") or 0)
        cfg = rotacion_cargar()
        base = _rot_ahora(cfg)
        f_sal = _rot_fecha(cfg.get("salida")) or base
        f_ent = _rot_fecha(cfg.get("entrada")) or (f_sal + timedelta(minutes=3))
        cfg["salida"] = _rot_texto(f_sal + timedelta(days=dias))
        cfg["entrada"] = _rot_texto(f_ent + timedelta(days=dias))
        cfg["hecho_salida"] = False; cfg["hecho_entrada"] = False
        rotacion_guardar(cfg)
        return aiohttp.web.json_response({"ok": True, "cfg": cfg})
    except Exception as e:
        return aiohttp.web.json_response({"ok": False, "error": str(e)})

async def api_clan_rot_ahora(request):
    """Hacerlo ya mismo, sin esperar la hora."""
    try:
        d = await request.json()
        accion = str(d.get("accion") or "").strip()
        cfg = rotacion_cargar()
        if accion == "salir":
            actual = str(cfg.get("clan_actual") or "").strip() or None
            asyncio.create_task(_rotacion_para_todos("salir", actual, origen=actual))
            return aiohttp.web.json_response({"ok": True, "msg": "Sacando a los bots del clan, mira la consola"})
        if accion == "entrar":
            cid = str(cfg.get("clan_id") or "").strip()
            if not cid:
                return aiohttp.web.json_response({"ok": False, "error": "Primero pon el ID del clan nuevo"})
            actual = str(cfg.get("clan_actual") or "").strip() or None
            asyncio.create_task(_rotacion_para_todos("entrar", cid, origen=actual))
            return aiohttp.web.json_response({"ok": True, "msg": f"Metiendo a los bots al clan {cid}, mira la consola"})
        return aiohttp.web.json_response({"ok": False, "error": "Acción desconocida"})
    except Exception as e:
        return aiohttp.web.json_response({"ok": False, "error": str(e)})

async def api_logs_clear(request):
    bot_state.logs = []
    return aiohttp.web.json_response({"status": "ok"})

async def account_loop_token(token):
    print_info(f"[TOKEN] Entrando con el token {token[:20]}...")
    try:
        vc = await version_config("ID")
        if not vc: return
        release_version, client_version, server_url, gop_1, app_version = vc
        url = f"https://100067.connect.garena.com/oauth/token/inspect?token={token}"
        hdrs = {"User-Agent":"GarenaMSDK/4.0.19P4(G011A ;Android 9;en;US;)"}
        r = await client.get(url, headers=hdrs)
        if r.status_code != 200: return
        data = r.json()
        if 'error' in data: return
        open_id = data.get('open_id'); platform = data.get('platform', 4)
        if not open_id: return
        major_payload, login_payload = await get_payload(
            token, open_id, platform, client_version)
        res_json = await major_login(major_payload, server_url, release_version)
        if not res_json: return
        def _gd(k):
            v = res_json.get(str(k))
            if isinstance(v, dict) and "data" in v: return v["data"]
            return v
        acc_id_raw = _gd(1); jwt_token = _gd(8)
        server_url_raw = _gd(10); server_time = _gd(21)
        region_raw = _gd(2) or "ID"
        aes_ak, iv_i = _extract_key_iv(res_json)
        if not (jwt_token and server_url_raw and aes_ak): return
        ld = await get_login_data(login_payload, jwt_token, server_url_raw, release_version)
        def _gf(f, d=None):
            v = (ld or {}).get(str(f), {}).get("data")
            return v if v is not None else d
        level = int(_gf(6,1) or 1); exp = int(_gf(7,0) or 0)
        nickname = _gf(4, f"Player_{acc_id_raw}") or f"Player_{acc_id_raw}"
        ad = {'account_id':acc_id_raw,'nickname':nickname,'region':region_raw,
            'level':level,'exp':exp,'likes':int(_gf(8,0) or 0),
            'open_id':open_id,'access_token':token,'platform':str(platform),
            'token':jwt_token,'server_time':server_time,
            'aes_ak':aes_ak,'iv_i':iv_i,
            'functional_addrs':_gf_field(ld, 14),
            'informational_addrs':_gf_field(ld, 32),
            'release_version':release_version,'client_version':client_version,
            'server_url':server_url_raw,'login_payload_data':login_payload,
            'auth_type':'token','auth_token':token}
        _register_credentials(ad)
        cache_set(f"tok_{token[:20]}", ad)
        await run_account_worker(ad, str(acc_id_raw))
    except Exception as e:
        print_error(f"[TOKEN] {e}")

async def start_web_server():
    app = aiohttp.web.Application(middlewares=[_req_logger])
    app.router.add_get("/", serve_index)
    app.router.add_get("/index.html", serve_index)
    app.router.add_get("/api/ping", api_ping)
    app.router.add_get("/api/stats", api_stats)
    app.router.add_get("/api/state", api_state)
    app.router.add_post("/api/create_team", api_create_team)
    app.router.add_post("/api/squad/add_bot", api_squad_add_bot)
    app.router.add_post("/api/squad/invite_player", api_squad_invite_player)
    app.router.add_post("/api/squad/hold", api_squad_hold)
    app.router.add_post("/api/account/add", api_account_add)
    app.router.add_post("/api/account/delete", api_account_delete)
    app.router.add_post("/api/account/refresh", api_account_refresh)
    app.router.add_post("/api/account/restart", api_account_restart)
    app.router.add_post("/api/account/pause", api_account_pause)
    app.router.add_post("/api/account/pause_all", api_account_pause_all)
    app.router.add_post("/api/logs/clear", api_logs_clear)
    app.router.add_get("/api/progress", api_progress)
    app.router.add_get("/api/sistema", api_sistema)
    app.router.add_post("/api/clanes/nombre", api_clan_nombre)
    app.router.add_get("/api/clan/rotacion", api_clan_rot_get)
    app.router.add_post("/api/clan/rotacion", api_clan_rot_set)
    app.router.add_post("/api/clan/rotacion/ajustar", api_clan_rot_ajustar)
    app.router.add_post("/api/clan/rotacion/ahora", api_clan_rot_ahora)
    runner = aiohttp.web.AppRunner(app)
    await runner.setup()
    site = aiohttp.web.TCPSite(runner, WEB_HOST, WEB_PORT)
    await site.start()
    print_premium(f"Panel web → http://localhost:{WEB_PORT}",
                  color=PX.CYAN, icon=I["rocket"], tag="WEB")
    return runner

# ==================== PRINCIPAL ====================
async def main():
    print_banner()
    try:
        await start_web_server()
    except Exception as e:
        print_error(f"[WEB] {e}"); return
    try:
        await _autoload_accounts()
    except Exception as e:
        print_error(f"[INICIO] No se pudieron cargar las cuentas: {e}")
    asyncio.create_task(_no_match_watchdog())
    asyncio.create_task(_rotacion_loop())
    asyncio.create_task(sistema.bucle())
    print_rule("GUILD GLORY BOT · Todo listo y funcionando", color=PX.EMERALD)
    try:
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        print_warning("Apagando...")
        for t in list(bot_state.account_workers.values()):
            t.cancel()
        await asyncio.gather(*bot_state.account_workers.values(), return_exceptions=True)
        try: await client.aclose()
        except Exception: pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print_warning("detenido")

# ╔══════════════════════════════════════════════════════════════════════╗
# ║   Fin del archivo  —  GUILD GLORY BOT                                ║
# ╚══════════════════════════════════════════════════════════════════════╝