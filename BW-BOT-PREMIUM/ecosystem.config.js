'use strict';

// Configuración de PM2 para producción 24/7.
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     (arranque automático al reiniciar el servidor)
//
// IMPORTANTE: una sola instancia en modo fork. Una sesión de WhatsApp no puede
// compartirse entre procesos (el bot además lo impide con un lock de instancia).
module.exports = {
  apps: [
    {
      name: 'bw-bot-premium',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // Si cae en menos de 30 s se considera un arranque fallido; con backoff exponencial para no entrar en bucle.
      min_uptime: '30s',
      max_restarts: 50,
      exp_backoff_restart_delay: 2000,
      // Mayor que el plazo de apagado del bot (15 s) para permitir el cierre limpio con SIGINT.
      kill_timeout: 20000,
      max_memory_restart: '512M',
      watch: false,
      time: true,
      merge_logs: true,
      out_file: './data/logs/pm2-out.log',
      error_file: './data/logs/pm2-error.log',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
