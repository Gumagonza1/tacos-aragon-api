const router  = require('express').Router();
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cfg     = require('../config');
const agente  = require('../services/agente');

const MAX_MSG_LEN  = 2000;
const MAX_ID_LEN   = 100;
const MAX_TEXT_LEN = 2000;

const ALLOWED_AUDIO_TYPES = [
  'audio/webm', 'audio/ogg', 'audio/mp4',
  'audio/mpeg', 'audio/wav', 'audio/x-wav',
];

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },   // 5 MB máximo
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
      return cb(new Error('Tipo de archivo no permitido'));
    }
    cb(null, true);
  },
});
const genAI  = new GoogleGenerativeAI(cfg.GEMINI_KEY);

// POST /api/agente/chat – Text chat with the agent
// Body: { sessionId, mensaje }
router.post('/chat', async (req, res) => {
  try {
    const { sessionId = 'default', mensaje, deviceTime } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: 'mensaje requerido' });
    if (mensaje.length > MAX_MSG_LEN) return res.status(400).json({ error: 'mensaje demasiado largo' });
    if (typeof sessionId !== 'string' || sessionId.length > MAX_ID_LEN) {
      return res.status(400).json({ error: 'sessionId inválido' });
    }

    const respuesta = await agente.chatTexto(sessionId, mensaje, deviceTime);
    res.json({ respuesta, sessionId });
  } catch (err) {
    console.error('[agente/chat]', err.message);
    res.status(500).json({ error: 'Error al procesar el mensaje' });
  }
});

// POST /api/agente/voz – Audio → transcription → agent → text
// Multipart: audio (audio file), sessionId
router.post('/voz', upload.single('audio'), async (req, res) => {
  const audioPath = req.file?.path;
  try {
    const { sessionId = 'default', deviceTime } = req.body;

    if (!audioPath) return res.status(400).json({ error: 'audio requerido' });
    if (typeof sessionId !== 'string' || sessionId.length > MAX_ID_LEN) {
      return res.status(400).json({ error: 'sessionId inválido' });
    }

    const audioData   = fs.readFileSync(audioPath);
    const audioBase64 = audioData.toString('base64');
    const mimeType    = ALLOWED_AUDIO_TYPES.includes(req.file.mimetype)
      ? req.file.mimetype
      : 'audio/webm';

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
    res.status(500).json({ error: 'Error al procesar el audio' });
  } finally {
    if (audioPath) {
      fs.unlink(audioPath, (e) => {
        if (e) console.error('[agente/voz] Error al eliminar archivo temporal:', e.message);
      });
    }
  }
});

// GET /api/agente/resumen?periodo=hoy|semana|mes
router.get('/resumen', async (req, res) => {
  try {
    const periodos = ['hoy', 'semana', 'mes'];
    const periodo  = periodos.includes(req.query.periodo) ? req.query.periodo : 'hoy';
    const resumen  = await agente.generarResumen(periodo);
    res.json({ resumen, periodo });
  } catch (err) {
    console.error('[agente/resumen]', err.message);
    res.status(500).json({ error: 'Error al generar resumen' });
  }
});

// ─── Monitor endpoints ────────────────────────────────────────────────────────
function monitorPath(file) {
  if (!cfg.DATOS_PATH) throw new Error('DATOS_PATH no configurado');
  // Validar que el nombre de archivo no contenga traversal
  const nombre = path.basename(file);
  return path.join(cfg.DATOS_PATH, nombre);
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
    console.error('[agente/monitor/estado]', err.message);
    res.status(500).json({ error: 'Error al leer estado del monitor' });
  }
});

// GET /api/agente/monitor/alertas
router.get('/monitor/alertas', (req, res) => {
  try {
    const pendientes = readJson(monitorPath('agente_pendientes.json'), []);
    res.json({ alertas: pendientes });
  } catch (err) {
    console.error('[agente/monitor/alertas]', err.message);
    res.status(500).json({ error: 'Error al leer alertas' });
  }
});

// POST /api/agente/monitor/comando
// Body: { texto, id? }  — id solo si se responde a una alerta/propuesta específica
router.post('/monitor/comando', (req, res) => {
  try {
    const { texto, id } = req.body;
    if (!texto?.trim()) return res.status(400).json({ error: 'texto requerido' });
    if (texto.length > MAX_TEXT_LEN) return res.status(400).json({ error: 'texto demasiado largo' });
    if (id !== undefined && (typeof id !== 'string' || id.length > MAX_ID_LEN)) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const RESP_PATH = monitorPath('agente_responses.json');
    const responses = readJson(RESP_PATH, []);
    if (responses.length > 500) {
      return res.status(429).json({ error: 'Cola de respuestas llena' });
    }

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
    console.error('[agente/monitor/comando]', err.message);
    res.status(500).json({ error: 'Error al procesar comando' });
  }
});

// POST /api/agente/encolar – Monitor → API → agente_queue.json → WhatsApp
// Body: { id, mensaje, timestamp }
router.post('/encolar', (req, res) => {
  try {
    const { id, mensaje, timestamp } = req.body;
    if (!id || !mensaje) return res.status(400).json({ error: 'id y mensaje requeridos' });
    if (typeof id !== 'string' || id.length > MAX_ID_LEN) {
      return res.status(400).json({ error: 'id inválido' });
    }
    if (typeof mensaje !== 'string' || mensaje.length > MAX_MSG_LEN) {
      return res.status(400).json({ error: 'mensaje inválido o demasiado largo' });
    }
    if (timestamp !== undefined && typeof timestamp !== 'number') {
      return res.status(400).json({ error: 'timestamp inválido' });
    }

    const QUEUE_PATH = monitorPath('agente_queue.json');
    let queue = readJson(QUEUE_PATH, []);
    if (queue.length > 1000) {
      return res.status(429).json({ error: 'Cola de mensajes llena' });
    }

    queue.push({ id, mensaje, enviado: false, timestamp: timestamp || Date.now() });
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));

    res.json({ ok: true, id });
  } catch (err) {
    console.error('[agente/encolar]', err.message);
    res.status(500).json({ error: 'Error al encolar mensaje' });
  }
});

// GET /api/agente/pendientes – Monitor lee respuestas del admin
router.get('/pendientes', (req, res) => {
  try {
    const RESP_PATH = monitorPath('agente_responses.json');
    const responses = readJson(RESP_PATH, []);

    // Limpiar el archivo después de entregar
    fs.writeFileSync(RESP_PATH, '[]');

    res.json({ responses });
  } catch (err) {
    console.error('[agente/pendientes]', err.message);
    res.status(500).json({ error: 'Error al leer pendientes' });
  }
});

module.exports = router;
