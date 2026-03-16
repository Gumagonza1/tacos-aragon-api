const router  = require('express').Router();
const multer  = require('multer');
const fs      = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cfg     = require('../config');
const agente  = require('../services/agente');

const upload = multer({ dest: '/tmp/uploads/' });
const genAI  = new GoogleGenerativeAI(cfg.GEMINI_KEY);

// POST /api/agente/chat – Text chat with the agent
// Body: { sessionId, mensaje }
router.post('/chat', async (req, res) => {
  try {
    const { sessionId = 'default', mensaje, deviceTime } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: 'mensaje requerido' });

    const respuesta = await agente.chatTexto(sessionId, mensaje, deviceTime);
    res.json({ respuesta, sessionId });
  } catch (err) {
    console.error('[agente/chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agente/voz – Audio → transcription → agent → text
// Multipart: audio (audio file), sessionId
router.post('/voz', upload.single('audio'), async (req, res) => {
  const audioPath = req.file?.path;
  try {
    const { sessionId = 'default', deviceTime } = req.body;

    if (!audioPath) return res.status(400).json({ error: 'audio requerido' });

    const audioData   = fs.readFileSync(audioPath);
    const audioBase64 = audioData.toString('base64');
    const mimeType    = req.file.mimetype || 'audio/webm';

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const transcResult = await model.generateContent([
      { inlineData: { mimeType, data: audioBase64 } },
      'Transcribe exactamente lo que dice este audio en español. Solo devuelve el texto transcrito, sin explicaciones.',
    ]);
    const transcripcion = transcResult.response.text().trim();

    const respuesta = await agente.chatTexto(sessionId, transcripcion, deviceTime);

    res.json({ transcripcion, respuesta, sessionId });
  } catch (err) {
    console.error('[agente/voz]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (audioPath) fs.unlink(audioPath, () => {});
  }
});

// GET /api/agente/resumen?periodo=hoy|semana|mes
router.get('/resumen', async (req, res) => {
  try {
    const { periodo = 'hoy' } = req.query;
    const resumen = await agente.generarResumen(periodo);
    res.json({ resumen, periodo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Monitor endpoints ────────────────────────────────────────────────────────
function monitorPath(file) {
  return require('path').join(cfg.DATOS_PATH || '', file);
}
function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

// GET /api/agente/monitor/estado
router.get('/monitor/estado', (req, res) => {
  try {
    const estadoConv  = readJson(monitorPath('agente_estado.json'), {});
    const queue       = readJson(monitorPath('agente_queue.json'), []);
    const pendientes  = readJson(monitorPath('agente_pendientes.json'), []);

    res.json({
      conversacionesVigiladas: Object.keys(estadoConv).length,
      pendientes:              pendientes.length,
      alertasPendientes:       pendientes.filter(p => p.tipo === 'alerta').length,
      propuestasPendientes:    pendientes.filter(p => p.tipo === 'propuesta').length,
      mensajesSinEnviar:       queue.filter(q => !q.enviado).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agente/monitor/alertas
router.get('/monitor/alertas', (req, res) => {
  try {
    const pendientes = readJson(monitorPath('agente_pendientes.json'), []);
    res.json({ alertas: pendientes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agente/monitor/comando
// Body: { texto, id? }  — id solo si se responde a una alerta/propuesta específica
router.post('/monitor/comando', (req, res) => {
  try {
    const { texto, id } = req.body;
    if (!texto?.trim()) return res.status(400).json({ error: 'texto requerido' });

    const RESP_PATH = monitorPath('agente_responses.json');
    const responses = readJson(RESP_PATH, []);

    const ESPECIALES = ['reporte', 'estado', 'propuestas'];
    let entry;
    if (ESPECIALES.includes(texto.toLowerCase())) {
      entry = { id: `cmd-${texto.toLowerCase()}`, texto: texto.toLowerCase(), timestamp: Date.now() };
    } else if (id) {
      entry = { id, texto, timestamp: Date.now() };
    } else {
      entry = { id: `conv-${Date.now()}`, texto, timestamp: Date.now() };
    }

    responses.push(entry);
    fs.writeFileSync(RESP_PATH, JSON.stringify(responses, null, 2));
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agente/encolar – Monitor → API → agente_queue.json → WhatsApp
// Body: { id, mensaje, timestamp }
router.post('/encolar', (req, res) => {
  try {
    const { id, mensaje, timestamp } = req.body;
    if (!id || !mensaje) return res.status(400).json({ error: 'id y mensaje requeridos' });

    const QUEUE_PATH = require('path').join(cfg.DATOS_PATH || '', 'agente_queue.json');
    let queue = [];
    try { queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')); } catch(e) {}

    queue.push({ id, mensaje, enviado: false, timestamp: timestamp || Date.now() });
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));

    res.json({ ok: true, id });
  } catch (err) {
    console.error('[agente/encolar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agente/pendientes – Monitor lee respuestas del admin
router.get('/pendientes', (req, res) => {
  try {
    const RESP_PATH = require('path').join(cfg.DATOS_PATH || '', 'agente_responses.json');
    let responses = [];
    try { responses = JSON.parse(fs.readFileSync(RESP_PATH, 'utf8')); } catch(e) {}

    // Limpiar el archivo después de entregar
    fs.writeFileSync(RESP_PATH, '[]');

    res.json({ responses });
  } catch (err) {
    console.error('[agente/pendientes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
