'use strict';

const http = require('node:http');

/**
 * Servidor HTTP mínimo para health checks (Docker, PM2, balanceadores, uptime monitors).
 *
 *   GET /health   liveness: 200 mientras el proceso responda.
 *   GET /ready    readiness: 200 solo si WhatsApp está conectado, 503 si no.
 *   GET /status   JSON con el estado completo (sin secretos).
 *
 * Solo acepta GET/HEAD y no expone nada más. Por defecto escucha en 127.0.0.1.
 */
class HealthServer {
  constructor({ getStatus, logger = null }) {
    this.getStatus = getStatus;
    this.logger = logger;
    this.server = null;
    this.port = null;
  }

  _handle(req, res) {
    const send = (code, body) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(code, {
        'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : payload);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Método no permitido');

    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return send(400, 'Solicitud inválida');
    }

    try {
      if (pathname === '/health') return send(200, 'ok');
      if (pathname === '/ready') {
        const s = this.getStatus();
        return send(s.whatsapp.state === 'open' ? 200 : 503, s.whatsapp.state === 'open' ? 'ready' : `no listo: ${s.whatsapp.state}`);
      }
      if (pathname === '/status') return send(200, this.getStatus());
      return send(404, 'No encontrado');
    } catch (err) {
      this.logger?.error('Error en el health check', err);
      return send(500, 'Error interno');
    }
  }

  /** Inicia el servidor. port 0 usa un puerto libre (útil en tests). Devuelve el puerto real. */
  start({ port, host = '127.0.0.1' }) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._handle(req, res));
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        server.on('error', (err) => this.logger?.error('Error del servidor de health check', err));
        this.server = server;
        this.port = server.address().port;
        this.logger?.info(`Health check escuchando en http://${host}:${this.port}/health`);
        resolve(this.port);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      const server = this.server;
      this.server = null;
      server.close(() => resolve());
      if (server.closeAllConnections) server.closeAllConnections();
    });
  }
}

module.exports = { HealthServer };
