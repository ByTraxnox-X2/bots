# -*- coding: utf-8 -*-
"""
Estado del servidor para el panel: CPU, RAM, disco, red, tiempo encendido...

No necesita instalar nada: lee lo que Linux ya publica en /proc y /sys.
Si el bot corre dentro de un contenedor (hosting tipo panel), usa el LÍMITE del
contenedor, que es lo que de verdad se puede llenar, y no la RAM de toda la máquina.
En Windows o Mac muestra lo que pueda y el resto queda en blanco.
"""
import os
import platform
import shutil
import socket
import sys
import time
from collections import deque

HISTORIAL = 72          # 72 muestras x 5 s = 6 minutos
CADA = 5.0

_hist = {"cpu": deque(maxlen=HISTORIAL), "ram": deque(maxlen=HISTORIAL)}
_ult = {}
_prev = {}
_inicio_bot = time.time()


def _leer(ruta):
    try:
        with open(ruta, "r") as f:
            return f.read()
    except Exception:
        return None


def _num(txt):
    try:
        return int(str(txt).strip())
    except Exception:
        return None


# ---------------- memoria ----------------
def _meminfo():
    t = _leer("/proc/meminfo")
    if not t:
        return None
    d = {}
    for linea in t.splitlines():
        partes = linea.split()
        if len(partes) >= 2:
            try:
                d[partes[0].rstrip(":")] = int(partes[1]) * 1024
            except Exception:
                pass
    return d


def _cgroup_mem():
    """(limite, uso) del contenedor, o None si no hay límite."""
    lim = _leer("/sys/fs/cgroup/memory.max")                     # cgroup v2
    if lim is not None:
        lim = lim.strip()
        if lim and lim != "max":
            uso = _num(_leer("/sys/fs/cgroup/memory.current"))
            stat = _leer("/sys/fs/cgroup/memory.stat") or ""
            cache = 0
            for linea in stat.splitlines():
                if linea.startswith("inactive_file "):
                    cache = _num(linea.split()[1]) or 0
            if uso is not None:
                return int(lim), max(0, uso - cache)
        return None
    lim = _num(_leer("/sys/fs/cgroup/memory/memory.limit_in_bytes"))  # cgroup v1
    uso = _num(_leer("/sys/fs/cgroup/memory/memory.usage_in_bytes"))
    if lim and uso is not None and lim < (1 << 60):
        stat = _leer("/sys/fs/cgroup/memory/memory.stat") or ""
        cache = 0
        for linea in stat.splitlines():
            if linea.startswith("total_inactive_file "):
                cache = _num(linea.split()[1]) or 0
        return lim, max(0, uso - cache)
    return None


def _memoria():
    mi = _meminfo() or {}
    total = mi.get("MemTotal")
    libre = mi.get("MemAvailable")
    usada = (total - libre) if (total and libre is not None) else None
    contenedor = False
    cg = _cgroup_mem()
    if cg and (not total or cg[0] < total):
        total, usada = cg
        contenedor = True
    swap_t = mi.get("SwapTotal")
    swap_l = mi.get("SwapFree")
    return {
        "total": total, "usada": usada,
        "pct": round(100.0 * usada / total, 1) if (total and usada is not None) else None,
        "contenedor": contenedor,
        "swap_total": swap_t,
        "swap_usada": (swap_t - swap_l) if (swap_t is not None and swap_l is not None) else None,
    }


# ---------------- CPU ----------------
def _cpu_tiempos():
    t = _leer("/proc/stat")
    if not t:
        return None
    p = t.splitlines()[0].split()
    if p[0] != "cpu":
        return None
    v = [int(x) for x in p[1:9]]
    total = sum(v)
    ocioso = v[3] + v[4]
    return total, ocioso


def _cgroup_cpu():
    """(nucleos_limite, uso_en_segundos) del contenedor, o None."""
    mx = _leer("/sys/fs/cgroup/cpu.max")                         # v2
    if mx is not None:
        partes = mx.split()
        nuc = None
        if len(partes) == 2 and partes[0] != "max":
            try:
                nuc = int(partes[0]) / int(partes[1])
            except Exception:
                nuc = None
        st = _leer("/sys/fs/cgroup/cpu.stat") or ""
        uso = None
        for linea in st.splitlines():
            if linea.startswith("usage_usec "):
                uso = (_num(linea.split()[1]) or 0) / 1e6
        if nuc and uso is not None:
            return nuc, uso
        return None
    q = _num(_leer("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"))       # v1
    per = _num(_leer("/sys/fs/cgroup/cpu/cpu.cfs_period_us"))
    uso = _num(_leer("/sys/fs/cgroup/cpuacct/cpuacct.usage"))
    if q and q > 0 and per and uso is not None:
        return q / per, uso / 1e9
    return None


def _proc_propio():
    """CPU (segundos) y RAM del propio bot."""
    rss = hilos = None
    st = _leer("/proc/self/status") or ""
    for linea in st.splitlines():
        if linea.startswith("VmRSS:"):
            rss = (_num(linea.split()[1]) or 0) * 1024
        elif linea.startswith("Threads:"):
            hilos = _num(linea.split()[1])
    cpu_s = None
    s = _leer("/proc/self/stat")
    if s:
        try:
            campos = s.rsplit(")", 1)[1].split()
            tck = os.sysconf("SC_CLK_TCK")
            cpu_s = (int(campos[11]) + int(campos[12])) / float(tck)
        except Exception:
            cpu_s = None
    if cpu_s is None:
        try:
            cpu_s = time.process_time()
        except Exception:
            pass
    if rss is None:
        try:
            import resource
            r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            rss = r if sys.platform == "darwin" else r * 1024
        except Exception:
            pass
    try:
        archivos = len(os.listdir("/proc/self/fd"))
    except Exception:
        archivos = None
    return cpu_s, rss, hilos, archivos


def _red():
    t = _leer("/proc/net/dev")
    if not t:
        return None
    rx = tx = 0
    for linea in t.splitlines()[2:]:
        if ":" not in linea:
            continue
        nombre, datos = linea.split(":", 1)
        if nombre.strip() == "lo":
            continue
        c = datos.split()
        if len(c) >= 9:
            rx += int(c[0]); tx += int(c[8])
    return rx, tx


# ---------------- muestreo ----------------
def muestrear():
    """Toma una muestra. Llamar cada pocos segundos."""
    ahora = time.time()
    nucleos = os.cpu_count() or 1
    datos = {"t": ahora, "nucleos": nucleos}

    # CPU de la máquina o del contenedor
    cpu_pct = None
    cg = _cgroup_cpu()
    if cg:
        nuc_lim, uso = cg
        datos["nucleos_limite"] = round(nuc_lim, 2)
        p = _prev.get("cg")
        if p:
            dt = ahora - p[0]
            if dt > 0:
                cpu_pct = 100.0 * (uso - p[1]) / (dt * nuc_lim)
        _prev["cg"] = (ahora, uso)
    else:
        ct = _cpu_tiempos()
        if ct:
            p = _prev.get("cpu")
            if p and ct[0] > p[0]:
                cpu_pct = 100.0 * (1.0 - (ct[1] - p[1]) / float(ct[0] - p[0]))
            _prev["cpu"] = ct
    if cpu_pct is None and hasattr(os, "getloadavg"):
        try:
            cpu_pct = min(100.0, 100.0 * os.getloadavg()[0] / nucleos)
        except Exception:
            pass
    datos["cpu_pct"] = round(max(0.0, min(100.0, cpu_pct)), 1) if cpu_pct is not None else None

    # el propio bot
    cpu_s, rss, hilos, archivos = _proc_propio()
    bot_pct = None
    p = _prev.get("bot")
    if p and cpu_s is not None:
        dt = ahora - p[0]
        if dt > 0:
            base = datos.get("nucleos_limite") or nucleos
            bot_pct = 100.0 * (cpu_s - p[1]) / (dt * base)
    if cpu_s is not None:
        _prev["bot"] = (ahora, cpu_s)
    datos["bot"] = {
        "cpu_pct": round(max(0.0, min(100.0, bot_pct)), 1) if bot_pct is not None else None,
        "ram": rss, "hilos": hilos, "archivos": archivos,
        "encendido_seg": int(ahora - _inicio_bot),
    }

    datos["ram"] = _memoria()

    try:
        du = shutil.disk_usage(os.getcwd())
        # Igual que "df": lo usado contra lo que de verdad se puede usar (usado + libre)
        util = du.used + du.free
        datos["disco"] = {"total": util, "usado": du.used, "libre": du.free,
                          "pct": round(100.0 * du.used / util, 1) if util else None}
    except Exception:
        datos["disco"] = {"total": None, "usado": None, "libre": None, "pct": None}

    try:
        datos["carga"] = [round(x, 2) for x in os.getloadavg()]
    except Exception:
        datos["carga"] = None

    up = _leer("/proc/uptime")
    try:
        datos["servidor_encendido_seg"] = int(float(up.split()[0])) if up else None
    except Exception:
        datos["servidor_encendido_seg"] = None

    rd = _red()
    if rd:
        p = _prev.get("red")
        if p:
            dt = ahora - p[0]
            if dt > 0:
                datos["red"] = {"baja_bps": max(0, (rd[0] - p[1]) / dt),
                                "sube_bps": max(0, (rd[1] - p[2]) / dt),
                                "baja_total": rd[0], "sube_total": rd[1]}
        _prev["red"] = (ahora, rd[0], rd[1])
    datos.setdefault("red", None)

    datos["equipo"] = {
        "nombre": socket.gethostname(),
        "sistema": f"{platform.system()} {platform.release()}",
        "arquitectura": platform.machine(),
        "python": platform.python_version(),
    }

    if datos["cpu_pct"] is not None:
        _hist["cpu"].append(datos["cpu_pct"])
    if (datos["ram"] or {}).get("pct") is not None:
        _hist["ram"].append(datos["ram"]["pct"])
    _ult.clear()
    _ult.update(datos)
    return datos


def ultimo():
    """La última muestra + el historial corto para las gráficas chiquitas."""
    if not _ult:
        muestrear()
    d = dict(_ult)
    d["historial"] = {"cpu": list(_hist["cpu"]), "ram": list(_hist["ram"]), "cada_seg": CADA}
    return d


async def bucle():
    """Tarea de fondo: una muestra cada CADA segundos."""
    import asyncio
    while True:
        try:
            muestrear()
        except Exception:
            pass
        await asyncio.sleep(CADA)
