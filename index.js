// Lanzador: prepara Python, enciende el bot (main.py) y protege el panel con contraseña.
// No necesita instalar nada de Node.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const DIR = __dirname;
process.chdir(DIR);
const log = m => console.log('[LANZADOR] ' + m);

// ---------- .env ----------
try {
  for (const linea of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    const k = l.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
} catch (e) {}

const PUERTO = Number(process.env.PUERTO_PANEL || process.env.SERVER_PORT || process.env.PORT || 8080);
let INTERNO = Number(process.env.BOT_INTERNAL_PORT || 18080);
if (INTERNO === PUERTO) INTERNO += 1;
const USUARIO = process.env.PANEL_USER || 'admin';
const CLAVE = process.env.PANEL_PASSWORD || '';
const LIBS = path.join(DIR, '.pylibs');
let estado = 'Preparando el bot, recarga en unos segundos...';

// ---------- Portero con contraseña ----------
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const igual = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const fallos = new Map();
function ipDe(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim(); }
function bloqueado(ip) {
  const d = fallos.get(ip);
  if (!d) return false;
  if (Date.now() - d.t > 10 * 60 * 1000) { fallos.delete(ip); return false; }
  return d.n >= 10;
}
function autorizado(req) {
  if (!CLAVE) return false;
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Basic ')) return false;
  const txt = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = txt.indexOf(':');
  if (i < 0) return false;
  return igual(txt.slice(0, i), USUARIO) && igual(txt.slice(i + 1), CLAVE);
}

const servidor = http.createServer((req, res) => {
  const ip = ipDe(req);
  if (bloqueado(ip)) { res.writeHead(429, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('Demasiados intentos. Espera unos minutos.'); }
  if (!autorizado(req)) {
    if (req.headers['authorization']) { const d = fallos.get(ip) || {n: 0, t: Date.now()}; d.n++; fallos.set(ip, d); }
    res.writeHead(401, {'WWW-Authenticate': 'Basic realm="Panel del bot", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8'});
    return res.end('Necesitas la contraseña del panel.');
  }
  fallos.delete(ip);
  const p = http.request({host: '127.0.0.1', port: INTERNO, path: req.url, method: req.method,
    headers: {...req.headers, host: '127.0.0.1:' + INTERNO}}, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => { if (!res.headersSent) res.writeHead(502, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(estado); });
  req.pipe(p);
});
servidor.listen(PUERTO, '0.0.0.0', () => log('Panel de Guild Glory protegido en el puerto ' + PUERTO + ' (usuario: ' + USUARIO + ')'));
if (!CLAVE) log('AVISO: falta PANEL_PASSWORD en el archivo .env, el panel quedará bloqueado.');

// ---------- Python ----------
// Las librerías ya vienen dentro del ZIP (carpeta vendor), así no hace falta pip.
const VENDOR = path.join(DIR, 'vendor', process.arch);
// Si existe .venv (lo crea instalar-oracle.sh en un VPS), se usa ese Python con sus propias
// librerías y no las de la carpeta vendor.
const VENV_PY = path.join(DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
let SIN_VENDOR = false;
const entorno = extra => ({...process.env,
  PYTHONPATH: (SIN_VENDOR ? [LIBS, process.env.PYTHONPATH] : [VENDOR, LIBS, process.env.PYTHONPATH]).filter(Boolean).join(path.delimiter),
  PYTHONUNBUFFERED: '1', ...extra});
function buscarPython() {
  const propios = [process.env.PYTHON_BIN, fs.existsSync(VENV_PY) ? VENV_PY : null].filter(Boolean);
  for (const c of [...propios, 'python3', 'python']) {
    const r = spawnSync(c, ['--version'], {encoding: 'utf8'});
    if (r.status === 0) {
      SIN_VENDOR = propios.includes(c);
      log('Encontré ' + (r.stdout || r.stderr).trim() + ' (' + c + ')' + (SIN_VENDOR ? ' con sus propias librerías' : ''));
      return c;
    }
  }
  return null;
}
const depsListas = py => spawnSync(py, ['-c', 'import aiohttp, httpx, Crypto, google_play_scraper, google.protobuf, protobuf_decoder'], {env: entorno()}).status === 0;
function instalarDeps(py) {
  log('Instalando lo que necesita el bot (la primera vez tarda unos minutos)...');
  const base = ['-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', '--target', LIBS, '-r', 'requirements.txt'];
  let r = spawnSync(py, base, {stdio: 'inherit', env: entorno()});
  if (r.status !== 0) r = spawnSync(py, [...base, '--break-system-packages'], {stdio: 'inherit', env: entorno()});
  if (r.status !== 0) {
    log('pip no está disponible, intento descargarlo...');
    const d = spawnSync(py, ['-c', "import urllib.request;urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py','get-pip.py')"], {stdio: 'inherit'});
    if (d.status === 0) {
      spawnSync(py, ['get-pip.py', '--target', LIBS, '--no-warn-script-location'], {stdio: 'inherit', env: entorno()});
      r = spawnSync(py, base, {stdio: 'inherit', env: entorno()});
    }
  }
  return r.status === 0;
}

let hijo = null, espera = 3000, apagando = false;
function encenderBot(py) {
  const inicio = Date.now();
  estado = 'El bot se está encendiendo, recarga en unos segundos...';
  log('Encendiendo el bot...');
  hijo = spawn(py, ['-u', 'main.py'], {cwd: DIR, env: entorno({PORT: String(INTERNO), WEB_HOST: '127.0.0.1'}), stdio: 'inherit'});
  hijo.on('exit', (code, sig) => {
    if (apagando) return;
    espera = Date.now() - inicio > 60000 ? 3000 : Math.min(espera * 2, 60000);
    estado = 'El bot se reinició, recarga en unos segundos...';
    log('El bot se detuvo (código ' + code + (sig ? ', señal ' + sig : '') + '). Reintento en ' + Math.round(espera / 1000) + ' s');
    setTimeout(() => encenderBot(py), espera);
  });
}

function salir() { apagando = true; try { if (hijo) hijo.kill('SIGTERM'); } catch (e) {} setTimeout(() => process.exit(0), 500); }
process.on('SIGTERM', salir);
process.on('SIGINT', salir);

(function iniciar() {
  const py = buscarPython();
  if (!py) {
    estado = 'Este hosting no tiene Python instalado.';
    log('*** ESTE HOSTING NO TIENE PYTHON. El bot es de Python y no puede encender aquí. ***');
    log('Pídele a soporte Python 3.10 o más nuevo, o usa un hosting que lo incluya.');
    return;
  }
  if (depsListas(py)) {
    log(SIN_VENDOR ? 'Librerías del entorno propio (.venv) listas.' : 'Librerías incluidas en el ZIP listas (' + process.arch + ').');
  } else {
    log('Las librerías incluidas no sirven para este equipo (' + process.arch + '), intento instalarlas...');
    estado = 'Instalando el bot por primera vez, puede tardar unos minutos...';
    if (!instalarDeps(py) || !depsListas(py)) {
      estado = 'No se pudieron instalar las dependencias. Mira la consola.';
      log('*** NO SE PUDO INSTALAR LO NECESARIO. Revisa los mensajes de arriba. ***');
      return;
    }
    log('Dependencias listas.');
  }
  encenderBot(py);
})();
