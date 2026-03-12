/**
 * ecosystem.config.js — Configuración PM2 para tacos-aragon-api
 *
 * INSTRUCCIONES:
 * 1. Copia este archivo: cp ecosystem.config.example.js ecosystem.config.js
 * 2. Reemplaza los valores TU_* con tus credenciales reales
 * 3. NUNCA subas ecosystem.config.js al repositorio (está en .gitignore)
 */
module.exports = {
  apps: [{
    name:       'tacos-api',
    script:     'index.js',
    instances:  1,
    autorestart: true,
    watch:      false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV:  'production',
      PORT:      3001,

      // Token para autenticar la app móvil con esta API
      API_TOKEN: 'TU_TOKEN_SECRETO_AQUI',

      // Anthropic / Claude — agente con tool use
      // Genera tu key en: https://console.anthropic.com/settings/keys
      ANTHROPIC_KEY: 'sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',

      // Facturama PAC (CFDI 4.0)
      // Credenciales de https://app.facturama.mx
      FACTURAMA_USER:     'TU_USUARIO_FACTURAMA',
      FACTURAMA_PASSWORD: 'TU_PASSWORD_FACTURAMA',
      FACTURAMA_SANDBOX:  'true',   // cambiar a 'false' en producción

      // RFC del negocio emisor
      EMISOR_RFC:    'TU_RFC_AQUI',
      EMISOR_NOMBRE: 'Tu Razón Social Aquí',

      // Loyverse POS
      LOYVERSE_TOKEN:    'TU_TOKEN_LOYVERSE',
      LOYVERSE_STORE_ID: 'TU_STORE_ID_LOYVERSE',

      // Gemini (voice STT)
      GEMINI_KEY: 'TU_API_KEY_GEMINI',

      // Shared data folder (bot-tacos/datos) — optional if using env vars above
      DATOS_PATH: 'C:\\ruta\\a\\bot-tacos\\datos',

      // Absolute paths to sibling projects — optional
      TAX_BOT_PATH: 'C:\\ruta\\a\\tax_aragon_bot',
      FISCAL_PATH:  'C:\\ruta\\a\\tacos-aragon-fiscal',
    },
  }],
};
