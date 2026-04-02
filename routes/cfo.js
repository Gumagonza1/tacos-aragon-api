'use strict';

/**
 * routes/cfo.js — Proxy genérico hacia el CFO agent (puerto 3002).
 * Permite que la app use solo el token de la API principal.
 */

const express  = require('express');
const axios    = require('axios');
const multer   = require('multer');
const FormData = require('form-data');
const cfg      = require('../config');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Multipart: subir XMLs manualmente ───────────────────────────────────────

router.post('/subir-xml', upload.array('archivos'), async (req, res) => {
  try {
    const form = new FormData();
    form.append('mes', req.body.mes || '');
    for (const f of (req.files || [])) {
      form.append('archivos', f.buffer, { filename: f.originalname, contentType: f.mimetype });
    }
    const { data, status } = await axios.post(
      `${cfg.CFO_BASE}/api/impuestos/subir-xml`,
      form,
      {
        headers: { ...form.getHeaders(), 'x-api-token': cfg.CFO_TOKEN },
        timeout: 60000,
        maxBodyLength: Infinity,
      }
    );
    res.status(status).json(data);
  } catch (err) {
    const r = err.response;
    r ? res.status(r.status).send(r.data)
      : res.status(502).json({ error: 'CFO agent no disponible' });
  }
});

// ─── JSON: proxy genérico para todo lo demás ─────────────────────────────────

router.all('*', async (req, res) => {
  try {
    const { data, status, headers } = await axios({
      method:  req.method,
      url:     `${cfg.CFO_BASE}${req.originalUrl}`,
      headers: { 'x-api-token': cfg.CFO_TOKEN },
      data:    req.body,
      timeout: 300000,
      maxBodyLength:    Infinity,
      maxContentLength: Infinity,
    });
    const ct = headers['content-type'];
    if (ct) res.set('Content-Type', ct);
    res.status(status).send(data);
  } catch (err) {
    const r = err.response;
    if (r) {
      res.status(r.status).send(r.data);
    } else {
      console.error('[cfo-proxy]', err.message);
      res.status(502).json({ error: 'CFO agent no disponible' });
    }
  }
});

module.exports = router;
