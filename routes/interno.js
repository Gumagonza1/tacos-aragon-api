'use strict';

const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const cfg    = require('../config');

const QUEUE_PATH = cfg.DATOS_PATH
  ? path.join(cfg.DATOS_PATH, 'agente_queue.json')
  : null;

function authInterno(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const bufA = Buffer.from(token);
    const bufB = Buffer.from(cfg.API_TOKEN);
    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      return next();
    }
  } catch {
    // fallo silencioso — retorna 401 abajo
  }

  console.warn(`[interno] Acceso denegado | IP: ${req.ip}`);
  return res.status(401).json({ error: 'No autorizado' });
}

// POST /interno/mensaje-admin
// Encola un mensaje para enviarlo al admin via el bot de WhatsApp.
// El bot lee agente_queue.json cada 10 segundos y envia los pendientes.
router.post('/mensaje-admin', authInterno, (req, res) => {
  const { mensaje } = req.body;

  if (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length === 0) {
    return res.status(400).json({ error: 'Campo "mensaje" requerido' });
  }

  if (mensaje.length > 4000) {
    return res.status(400).json({ error: 'Mensaje demasiado largo (max 4000 caracteres)' });
  }

  if (!QUEUE_PATH) {
    console.error('[interno] DATOS_PATH no configurado — no se puede encolar mensaje');
    return res.status(503).json({ error: 'Cola de mensajes no disponible — DATOS_PATH no configurado' });
  }

  try {
    let cola = [];
    if (fs.existsSync(QUEUE_PATH)) {
      try {
        cola = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8') || '[]');
        if (!Array.isArray(cola)) cola = [];
      } catch {
        cola = [];
      }
    }

    const item = {
      id:        `orch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mensaje:   mensaje.trim(),
      timestamp: Date.now(),
      enviado:   false,
      origen:    'orquestador',
    };

    cola.push(item);
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(cola, null, 2), 'utf8');

    console.log(`[interno] Mensaje encolado: ${item.id}`);
    res.json({ ok: true, id: item.id });
  } catch (err) {
    console.error('[interno] Error al escribir cola:', err.message);
    res.status(500).json({ error: 'Error interno al encolar mensaje' });
  }
});

module.exports = router;
