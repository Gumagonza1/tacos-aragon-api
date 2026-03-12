/**
 * services/whatsapp.js – Puente con el bot de WhatsApp (bot-tacos).
 * Lee/escribe directamente los archivos de datos del bot.
 */

const fs   = require('fs');
const path = require('path');
const cfg  = require('../config');

// Ruta a los archivos del bot
const BOT_PATH = path.join('C:', 'Users', 'gumaro_gonzalez', 'Desktop', 'bot-tacos');
const PAUSA_FILE = path.join(BOT_PATH, 'datos', 'pausas.json');

function leerMemoria() {
  try {
    const raw = fs.readFileSync(cfg.MEMORIA_CHAT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function leerPausas() {
  try {
    return JSON.parse(fs.readFileSync(PAUSA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function escribirPausas(pausas) {
  fs.writeFileSync(PAUSA_FILE, JSON.stringify(pausas, null, 2));
}

/**
 * Lista todas las conversaciones activas con su último mensaje y timestamp.
 */
function listarConversaciones() {
  const memoria = leerMemoria();
  const pausas  = leerPausas();

  return Object.entries(memoria).map(([phone, historia]) => {
    // La historia es un string con el historial completo
    const lineas   = historia.split('\n').filter(Boolean);
    const ultimo   = lineas[lineas.length - 1] || '';
    const esCliente = ultimo.startsWith('Cliente:') || ultimo.startsWith('User:');

    // Extraer timestamp si está presente (formato ISO en brackets)
    const tsMatch  = historia.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+)\]/g);
    const ultimoTs = tsMatch ? tsMatch[tsMatch.length - 1].replace(/[\[\]]/g, '') : null;

    return {
      phone,
      pausado: !!pausas[phone],
      ultimoMensaje: ultimo.replace(/^\w+:\s*/, '').slice(0, 120),
      timestamp: ultimoTs,
      mensajes: lineas.length,
      esperaRespuesta: esCliente,
    };
  });
}

/**
 * Obtiene el historial completo de una conversación.
 */
function obtenerConversacion(phone) {
  const memoria = leerMemoria();
  const pausas  = leerPausas();
  const historia = memoria[phone] || '';
  return {
    phone,
    pausado: !!pausas[phone],
    historia,
    mensajes: historia.split('\n').filter(Boolean).length,
  };
}

/**
 * Pausa / reanuda el bot para un número.
 */
function togglePausa(phone, pausar = true) {
  const pausas = leerPausas();
  if (pausar) {
    pausas[phone] = Date.now();
  } else {
    delete pausas[phone];
  }
  escribirPausas(pausas);
  return { phone, pausado: pausar };
}

/**
 * Estadísticas globales del bot.
 */
function estadisticas() {
  const memoria   = leerMemoria();
  const pausas    = leerPausas();
  const total     = Object.keys(memoria).length;
  const pausadas  = Object.keys(pausas).length;

  // Conversaciones activas en última hora
  const unaHoraAtras = Date.now() - 3600_000;
  let activas = 0;
  Object.values(memoria).forEach(h => {
    const tsMatch = h.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+)\]/g);
    if (tsMatch) {
      const ts = new Date(tsMatch[tsMatch.length - 1].replace(/[\[\]]/g, '')).getTime();
      if (ts > unaHoraAtras) activas++;
    }
  });

  return { totalConversaciones: total, pausadas, activasUltimaHora: activas };
}

module.exports = { listarConversaciones, obtenerConversacion, togglePausa, estadisticas };
