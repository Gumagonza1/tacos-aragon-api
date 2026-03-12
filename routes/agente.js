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

module.exports = router;
