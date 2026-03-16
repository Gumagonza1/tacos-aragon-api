/**
 * config.js – Loads all credentials and paths for the Tacos Aragón ecosystem.
 * All sensitive values must be set via environment variables (ecosystem.config.js / .env).
 * DATOS_PATH can point to the shared data folder when bots run on the same machine.
 */

const fs   = require('fs');
const path = require('path');

// Path to shared data folder. Set DATOS_PATH in your ecosystem.config.js.
const DATOS = process.env.DATOS_PATH || '';

function leer(archivo) {
  if (!DATOS) return null;
  try {
    return fs.readFileSync(path.join(DATOS, archivo), 'utf8').trim();
  } catch {
    return null;
  }
}

// ─── Validaciones de inicio obligatorias ─────────────────────────────────────
if (!process.env.API_TOKEN) {
  console.error('[config] ERROR: API_TOKEN is not set. Configure it in ecosystem.config.js or .env before starting.');
  process.exit(1);
}

const LOYVERSE_TOKEN = process.env.LOYVERSE_TOKEN || leer('loyverse_token.txt');
if (!LOYVERSE_TOKEN) {
  console.error('[config] ERROR: LOYVERSE_TOKEN is not set (env var or datos/loyverse_token.txt).');
  process.exit(1);
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || leer('anthropic_key.txt');
if (!ANTHROPIC_KEY) {
  console.error('[config] ERROR: ANTHROPIC_KEY is not set (env var or datos/anthropic_key.txt).');
  process.exit(1);
}

// ─── Config exportada ─────────────────────────────────────────────────────────
const cfg = {
  // ── Server port ───────────────────────────────────────────────
  PORT: process.env.PORT || 3001,

  // ── API authentication ────────────────────────────────────────
  API_TOKEN: process.env.API_TOKEN,

  // ── Loyverse ─────────────────────────────────────────────────
  LOYVERSE_TOKEN,
  LOYVERSE_STORE_ID:  process.env.LOYVERSE_STORE_ID  || leer('loyverse_store_id.txt'),
  LOYVERSE_BASE:      'https://api.loyverse.com/v1.0',

  // ── Google Gemini (voice STT) ─────────────────────────────────
  GEMINI_KEY: process.env.GEMINI_KEY || leer('llave ia.txt'),

  // ── Anthropic (main agent) ────────────────────────────────────
  ANTHROPIC_KEY,

  // ── WhatsApp bot shared data paths ───────────────────────────
  MEMORIA_CHAT_PATH:  DATOS ? path.join(DATOS, 'memoria_chat.json') : null,
  INSTRUCCIONES_PATH: DATOS ? path.join(DATOS, 'instrucciones.txt') : null,
  MENU_CSV_PATH:      DATOS ? path.join(DATOS, 'menu.csv') : null,

  // ── Facturama PAC ─────────────────────────────────────────────
  FACTURAMA_USER:     process.env.FACTURAMA_USER     || '',
  FACTURAMA_PASSWORD: process.env.FACTURAMA_PASSWORD || '',
  FACTURAMA_SANDBOX:  process.env.FACTURAMA_SANDBOX  !== 'false',

  // ── SAT / Fiscal paths ────────────────────────────────────────
  TAX_BOT_PATH:  process.env.TAX_BOT_PATH  || '',
  FISCAL_PATH:   process.env.FISCAL_PATH   || '',

  // ── Shared data folder (bot-tacos/datos) ─────────────────────
  DATOS_PATH: DATOS,

  // ── Business data ─────────────────────────────────────────────
  NEGOCIO: {
    nombre:     'Tacos Aragón',
    direccion:  'Culiacán, Sinaloa, México',
    horario:    'Mar–Dom 6 PM – 11:30 PM',
    descanso:   'Lunes',
  },
};

module.exports = cfg;
