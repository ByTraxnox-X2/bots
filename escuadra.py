# -*- coding: utf-8 -*-
"""
Cerebro de las escuadras (GUILD GLORY BOT).

Decide, para cada escuadra, cuándo armar el equipo, a quién invitar, cuándo aceptar
una invitación y cuándo darle a INICIAR. Todo lo que habla con el juego entra por el
objeto `io`, así este archivo se puede probar con un simulador sin abrir el juego.

Reglas que sigue:
  * Cada escuadra va por su lado: su líder, su equipo, su código.
  * Solo el líder inicia. Los miembros aceptan (una vez por equipo) y avisan "listo".
  * Ninguna espera es infinita: todo tiene tope.
  * Quién está en el equipo se decide con lo que de verdad pasó: quién entró a la última
    partida con el líder, y quién aceptó la invitación del equipo actual.
  * Al bot que ya está dentro NO se le vuelve a invitar: aceptar otra vez lo saca y lo
    vuelve a meter, y eso le corta el emparejamiento a toda la escuadra.
"""


class Ajustes:
    """Tiempos, en segundos."""
    PAUSA_TRAS_PARTIDA = 7.0       # todos de vuelta en el lobby → espera esto, revisa e inicia
    ESPERA_ACEPTAR = 7.0           # tras invitar, tope para que acepten
    ESPERA_ACEPTAR_2 = 4.0         # segunda invitación a los que no contestaron
    REINTENTO_INICIAR = 10.0       # sin partida → vuelve a darle a INICIAR cada tanto
    REARMAR_SIN_PARTIDA = 150.0    # buscando sin partida este rato → equipo nuevo
    CAMBIO_LIDER_TRAS = 2          # a la 2.ª vez sin partida, el mando pasa a otro bot
    PARTIDA_MAX = 1590.0           # una marca de "en partida" más vieja que esto se borra
    ANTIRREBOTE_ACEPTAR = 8.0      # un miembro no acepta dos veces en este rato
    RECUERDA_EQUIPOS = 1800.0      # equipos ya aceptados que se recuerdan
    LISTO_CADA = 5.0               # el miembro avisa "listo" cada tanto
    ESPERA_INICIAL_MIEMBRO = 8.0   # al conectar, el miembro espera esto antes de avisar "listo"
    ESPERA_MIEMBRO_TRAS_PARTIDA = 3.0
    ESPERA_EQUIPO_MAX = 120.0      # al arrancar, cuánto espera a que se conecten sus bots
    ESPERA_EQUIPO_REARME = 15.0    # al volver de partida, cuánto espera a un bot desconectado
    ESCALON_ESCUADRA = 1.2         # cada escuadra arranca un poquito después que la anterior
    AVISO_CADA = 20.0              # mensajes repetidos en consola, como mucho cada tanto


# ----------------------------------------------------------------------------------
#  Estado compartido de una escuadra (vive dentro del dict de la escuadra en main.py)
# ----------------------------------------------------------------------------------
def preparar(sq):
    """Asegura las claves que usa el cerebro."""
    for k in ("en_equipo", "en_partida", "aceptados", "ult_aceptar"):
        if not isinstance(sq.get(k), dict):
            sq[k] = {}
    if not isinstance(sq.get("jugaron"), set):
        sq["jugaron"] = set()


def conectados(sq):
    return list((sq.get("peers") or {}).keys())


def marcar_entra_partida(sq, uid, ahora):
    """Un bot de la escuadra entró a una partida."""
    preparar(sq)
    sq["en_partida"][uid] = float(ahora)
    sq["jugaron"].add(uid)
    lider = sq.get("leader_uid")
    if lider and uid != lider:
        # Entró a la partida con la escuadra: está en el equipo, seguro.
        sq["en_equipo"][uid] = ("jugo", float(ahora))


def marcar_sale_partida(sq, uid):
    """Un bot salió de su partida (terminó bien, falló al entrar, lo que sea)."""
    preparar(sq)
    sq["en_partida"].pop(uid, None)


def marcar_desconectado(sq, uid):
    """Un bot se desconectó: se borra todo lo suyo."""
    preparar(sq)
    for k in ("en_partida", "en_equipo", "aceptados", "ult_aceptar"):
        sq[k].pop(uid, None)
    sq["jugaron"].discard(uid)


def en_partida_ahora(sq, ahora, excluir=None):
    """Compañeros CONECTADOS que siguen dentro de una partida. Borra marcas viejas o de
    bots que ya no están, así nunca se queda esperando a un fantasma."""
    preparar(sq)
    peers = sq.get("peers") or {}
    quedan = []
    for u, t in list(sq["en_partida"].items()):
        try:
            vieja = (float(ahora) - float(t)) > Ajustes.PARTIDA_MAX
        except Exception:
            vieja = True
        if u not in peers or vieja:
            sq["en_partida"].pop(u, None)
            continue
        if u != excluir:
            quedan.append(u)
    return quedan


def equipo_nuevo(sq):
    """El líder creó un equipo nuevo: nadie está dentro todavía."""
    preparar(sq)
    sq["en_equipo"].clear()
    sq["jugaron"] = set()


def revisar_ultima_partida(sq, lider):
    """Después de una partida: quien jugó sigue en el equipo; quien no jugó, falta.
    Devuelve (jugaron, no_jugaron) entre los conectados, o None si no hubo partida."""
    preparar(sq)
    jug = set(sq["jugaron"])
    if not jug:
        return None
    sq["jugaron"] = set()
    otros = [u for u in conectados(sq) if u != lider]
    si = [u for u in otros if u in jug]
    no = [u for u in otros if u not in jug]
    for u in no:
        # No estaba en el equipo (o se le perdió el aviso): se le vuelve a invitar y,
        # para que acepte, se olvida que ya había aceptado este equipo.
        sq["en_equipo"].pop(u, None)
        sq["aceptados"].pop(u, None)
        sq["ult_aceptar"].pop(u, None)
    return si, no


def faltan_en_equipo(sq, lider):
    """Compañeros conectados que el líder todavía no tiene en su equipo."""
    preparar(sq)
    return [u for u in conectados(sq) if u != lider and u not in sq["en_equipo"]]


def decidir_aceptar(sq, uid, ids_en_paquete, grupo, ahora):
    """¿Este paquete de equipo es una invitación que este bot debe aceptar?
    Devuelve el id del líder al que hay que aceptarle, o None.

    - Solo se acepta al líder de SU escuadra (el id del líder tiene que venir en el paquete).
    - Cada equipo (grupo) se acepta UNA vez. Los avisos que el juego manda después sobre
      ese mismo equipo NO se vuelven a aceptar: eso lo sacaba y le cortaba la búsqueda.
    """
    preparar(sq)
    lider = str(sq.get("leader_uid") or "")
    uid = str(uid)
    if not lider or lider == uid or not grupo:
        return None
    ids = {str(x) for x in (ids_en_paquete or ())}
    if lider not in ids:
        return None
    vistos = sq["aceptados"].setdefault(uid, {})
    for g, t in list(vistos.items()):
        if float(ahora) - float(t) > Ajustes.RECUERDA_EQUIPOS:
            vistos.pop(g, None)
    grupo = str(grupo)
    if grupo in vistos:
        # Ya aceptó este equipo: sigue dentro. No se repite.
        sq["en_equipo"].setdefault(uid, ("acepto", float(vistos[grupo])))
        return None
    if float(ahora) - float(sq["ult_aceptar"].get(uid, 0)) < Ajustes.ANTIRREBOTE_ACEPTAR:
        return None
    vistos[grupo] = float(ahora)
    sq["ult_aceptar"][uid] = float(ahora)
    sq["en_equipo"][uid] = ("acepto", float(ahora))
    return lider


def elegir_nuevo_lider(sq, actual, pausado=None):
    """Otro bot conectado de la escuadra que no esté pausado."""
    for u in conectados(sq):
        if u == actual:
            continue
        if pausado and pausado(u):
            continue
        return u
    return None


def huella(sq):
    """Cuándo se conectó cada bot. Si cambia, es que se reconectó."""
    salida = {}
    for u, info in (sq.get("peers") or {}).items():
        try:
            salida[u] = (info or {}).get("conectado")
        except Exception:
            salida[u] = None
    return salida


# ----------------------------------------------------------------------------------
#  Ciclos (uno por bot): el del líder y el del miembro
# ----------------------------------------------------------------------------------
class _Avisos:
    """Para no llenar la consola con el mismo mensaje."""
    def __init__(self, io):
        self.io = io
        self.t = {}

    def una_vez_cada(self, clave, nivel, texto, cada=Ajustes.AVISO_CADA):
        ahora = self.io.ahora()
        if ahora - self.t.get(clave, -1e9) >= cada:
            self.t[clave] = ahora
            self.io.log(nivel, texto)


async def ciclo_lider(io, rearme=False):
    """Lo corren todos los bots; solo sigue de largo el que es líder."""
    A = Ajustes
    sq, yo = io.sq, str(io.uid)
    preparar(sq)
    av = _Avisos(io)

    # 1) Esperar a que estén conectados los bots de la escuadra (con tope)
    tope = A.ESPERA_EQUIPO_REARME if rearme else A.ESPERA_EQUIPO_MAX
    desde = io.ahora()
    while True:
        if io.pausado():
            return
        n = len(sq.get("peers") or {})
        esperados = max(1, int(io.esperados() or 1))
        if n >= esperados:
            break
        if n >= 1 and io.ahora() - desde >= tope:
            io.log("aviso", f"faltan {esperados - n} bot(s) por conectar; juegan los {n} que están")
            break
        io.fase("esperando")
        av.una_vez_cada("conectar", "info", f"esperando a sus bots ({n}/{esperados})")
        await io.dormir(0.5)

    if str(sq.get("leader_uid") or "") != yo:
        return  # es miembro: lo suyo lo hace ciclo_miembro

    # 2) El líder
    pausa_hecha = not rearme
    necesita_nuevo = (not rearme) or (not sq.get("team_code"))
    invitado = False
    escalonado = False
    busca_desde = None
    rehechos = 0
    intentos = 0
    conocidos = huella(sq)

    while io.activo():
        if io.pausado():
            return
        if str(sq.get("leader_uid") or "") != yo:
            return
        ahora = io.ahora()

        # a) Compañeros todavía dentro de una partida → se espera (sin buscar ni rearmar)
        en_p = en_partida_ahora(sq, ahora, excluir=yo)
        if en_p:
            io.fase("esperando_partida")
            av.una_vez_cada("en_partida", "info",
                            f"espera a que terminen la partida {len(en_p)} compañero(s)")
            busca_desde = None
            pausa_hecha = False
            await io.dormir(2.0)
            continue

        # b) Pediste entrar tú: la escuadra se queda quieta e invita a tu cuenta
        if await io.toca_esperar():
            await io.invitar_usuario()
            busca_desde = None
            await io.dormir(2.0)
            continue

        # c) Todos de vuelta: pausa corta antes de revisar
        if not pausa_hecha:
            io.fase("revisando")
            av.una_vez_cada("pausa", "info",
                            f"todos fuera de la partida; revisa la escuadra en "
                            f"{A.PAUSA_TRAS_PARTIDA:.0f} s", cada=1)
            await io.dormir(A.PAUSA_TRAS_PARTIDA if rearme else 1.0)
            pausa_hecha = True
            continue  # vuelve a mirar, por si alguien entró a partida mientras tanto

        # d) Equipo nuevo si hace falta; si no, ver quién no jugó la última partida
        if necesita_nuevo:
            io.fase("armando")
            io.log("lider", f"{yo} arma el equipo")
            equipo_nuevo(sq)
            await io.crear_equipo()
            await io.dormir(1.2)
            await io.refrescar_equipo()
            await io.dormir(0.6)
            necesita_nuevo = False
            invitado = False
            conocidos = huella(sq)
        else:
            r = revisar_ultima_partida(sq, yo)
            if r is not None:
                si, no = r
                if no:
                    io.log("aviso", f"{len(no)} bot(s) no entraron a la última partida; los invita")
                else:
                    io.log("ok", f"la escuadra sigue completa ({len(si) + 1}); inicia")
                invitado = False
                conocidos = huella(sq)

        if not escalonado:
            escalonado = True
            espera = ((max(1, int(io.numero_escuadra() or 1)) - 1) % 4) * A.ESCALON_ESCUADRA
            if espera:
                await io.dormir(espera)

        # e) Invitar SOLO a los que faltan (una vez por vuelta) y darles tiempo de aceptar
        if not invitado:
            invitado = True
            faltan = faltan_en_equipo(sq, yo)
            if faltan:
                io.fase("invitando")
                io.log("info", f"invita a {len(faltan)} bot(s)")
                await _invitar(io, faltan)
                quedan = await _esperar_aceptan(io, sq, yo, A.ESPERA_ACEPTAR)
                if quedan:
                    # No contestaron: no están dentro, así que invitarlos otra vez no
                    # saca a nadie. Una sola vez más.
                    io.log("aviso", f"{len(quedan)} no contestaron; los invita otra vez")
                    await _invitar(io, quedan)
                    quedan = await _esperar_aceptan(io, sq, yo, A.ESPERA_ACEPTAR_2)
                if quedan:
                    io.log("aviso", f"inicia sin {len(quedan)} bot(s) que no contestaron")
                else:
                    io.log("ok", f"los {len(conectados(sq))} están en el equipo")
                await io.refrescar_equipo()
                await io.dormir(0.8)
            busca_desde = io.ahora()
            intentos = 0

        # f) Un bot que se acaba de conectar y no está en el equipo: se le invita una vez
        ahora_h = huella(sq)
        nuevos = [u for u, h in ahora_h.items()
                  if u != yo and conocidos.get(u, "x") != h and u not in sq["en_equipo"]]
        conocidos = ahora_h
        if nuevos:
            io.log("info", f"se conectó {len(nuevos)} bot(s); los invita")
            await _invitar(io, nuevos)

        # g) Darle a INICIAR (la tarea se corta sola cuando llega la partida)
        if busca_desde is None:
            busca_desde = io.ahora()
        io.fase("buscando")
        io.estado("SEARCHING")
        await io.listo()
        await io.dormir(0.8)
        await io.iniciar()
        intentos += 1
        if intentos == 1:
            io.log("info", "el líder le dio a INICIAR")
        await io.dormir(A.REINTENTO_INICIAR)

        # h) Mucho rato sin partida → equipo nuevo; la segunda vez, el mando pasa a otro
        if io.ahora() - busca_desde >= A.REARMAR_SIN_PARTIDA:
            rehechos += 1
            if rehechos >= A.CAMBIO_LIDER_TRAS:
                nuevo = elegir_nuevo_lider(sq, yo, io.esta_pausado)
                if nuevo:
                    sq["leader_uid"] = nuevo
                    sq["team_code"] = None
                    equipo_nuevo(sq)
                    io.log("lider", f"no encontraba partida; ahora lleva el equipo {nuevo}")
                    io.hacerse_miembro()
                    return
            io.log("aviso", f"sin partida en {A.REARMAR_SIN_PARTIDA:.0f} s; arma un equipo nuevo")
            necesita_nuevo = True
            busca_desde = None


async def _invitar(io, uids):
    for u in uids:
        try:
            await io.invitar(io.id_juego(u))
        except Exception as e:
            io.log("aviso", f"no se pudo invitar a {u}: {e}")
        await io.dormir(0.35)


async def _esperar_aceptan(io, sq, lider, tope):
    t0 = io.ahora()
    while io.ahora() - t0 < tope:
        if not faltan_en_equipo(sq, lider):
            return []
        await io.dormir(0.5)
    return faltan_en_equipo(sq, lider)


async def ciclo_miembro(io, rearme=False):
    """El miembro: espera, avisa "listo" cada tanto y nunca inicia la partida."""
    A = Ajustes
    sq, yo = io.sq, str(io.uid)
    preparar(sq)
    await io.dormir(A.ESPERA_MIEMBRO_TRAS_PARTIDA if rearme else A.ESPERA_INICIAL_MIEMBRO)
    if str(sq.get("leader_uid") or "") == yo:
        return
    io.log("info", f"el miembro {yo} está listo")
    io.estado("SEARCHING")
    while io.activo():
        if io.pausado():
            return
        lid = str(sq.get("leader_uid") or "")
        peers = sq.get("peers") or {}
        if lid == yo:
            io.hacerse_lider()
            return
        # ¿El líder se fue o está pausado? Este bot toma el mando.
        if not lid or lid not in peers or io.esta_pausado(lid):
            sq["leader_uid"] = yo
            sq["team_code"] = None
            equipo_nuevo(sq)
            io.log("lider", f"el líder no está; ahora el líder es {yo}")
            io.hacerse_lider()
            return
        if io.esperando_usuario():
            await io.dormir(2.0)
            continue
        try:
            await io.listo()
        except Exception as e:
            io.log("aviso", f"error del miembro al avisar listo: {e}")
        await io.dormir(A.LISTO_CADA)


def ids_en(obj, limite=2000):
    """Todos los números largos (posibles id de cuenta) que hay en un paquete decodificado."""
    salida = set()
    pila = [obj]
    vistos = 0
    while pila and vistos < limite:
        x = pila.pop()
        vistos += 1
        if isinstance(x, dict):
            pila.extend(x.values())
        elif isinstance(x, (list, tuple)):
            pila.extend(x)
        elif isinstance(x, bool):
            continue
        elif isinstance(x, int):
            if x >= 100000:
                salida.add(str(x))
        elif isinstance(x, str):
            s = x.strip()
            if s.isdigit() and 6 <= len(s) <= 15:
                salida.add(s)
    return salida
