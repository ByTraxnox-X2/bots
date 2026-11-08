'use strict';

const fs = require('node:fs');

/**
 * Detecta en qué entorno corre el bot. Es solo informativo (logs, estado, instalador):
 * el código es el mismo en todos y se configura únicamente con variables de entorno.
 * Devuelve { platform, runtime, processManager }.
 */
function detectEnvironment({ env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  let runtime = 'linux';
  if (env.TERMUX_VERSION || String(env.PREFIX || '').includes('com.termux')) {
    runtime = 'termux';
  } else if (exists('/.dockerenv') || env.BW_IN_DOCKER === '1') {
    runtime = 'docker';
  } else if (platform === 'win32') {
    runtime = 'windows';
  } else if (platform === 'darwin') {
    runtime = 'macos';
  }

  let processManager = 'none';
  if (env.pm_id !== undefined) {
    processManager = 'pm2';
  } else if (env.INVOCATION_ID) {
    processManager = 'systemd';
  }

  return { platform, runtime, processManager };
}

module.exports = { detectEnvironment };
