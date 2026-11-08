'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: el proceso existe pero no tenemos permiso para señalarlo.
    return err.code === 'EPERM';
  }
}

/**
 * Lock de instancia basado en archivo. Evita dos procesos con la misma sesión.
 * Un lock cuyo PID ya no existe se considera obsoleto y se reemplaza.
 */
class InstanceLock {
  constructor(file, { pid = process.pid, isAlive = isProcessAlive } = {}) {
    this.file = path.resolve(file);
    this.pid = pid;
    this.isAlive = isAlive;
    this.held = false;
  }

  _read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Number.isInteger(parsed.pid) ? parsed : null;
    } catch {
      return null;
    }
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const payload = JSON.stringify({ pid: this.pid, startedAt: new Date().toISOString() });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(this.file, payload, { flag: 'wx' });
        this.held = true;
        return true;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const current = this._read();
        if (current && current.pid === this.pid) {
          this.held = true;
          return true;
        }
        if (current && this.isAlive(current.pid)) {
          const e = new Error(`Ya hay otra instancia de BW BOT en ejecución (PID ${current.pid}).`);
          e.code = 'ELOCKED';
          e.pid = current.pid;
          throw e;
        }
        // Lock obsoleto o ilegible: se elimina y se reintenta.
        try { fs.rmSync(this.file, { force: true }); } catch { /* ignorar */ }
      }
    }
    const e = new Error('No se pudo adquirir el lock de instancia.');
    e.code = 'ELOCKED';
    throw e;
  }

  release() {
    if (!this.held) return;
    this.held = false;
    const current = this._read();
    if (current && current.pid !== this.pid) return; // no borrar el lock de otro proceso
    try { fs.rmSync(this.file, { force: true }); } catch { /* ignorar */ }
  }
}

module.exports = { InstanceLock, isProcessAlive };
