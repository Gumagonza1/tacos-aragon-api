const router = require('express').Router();
const svc    = require('../services/whatsapp');

const PHONE_RE = /^\d{7,15}$/;

function validatePhone(phone) {
  return typeof phone === 'string' && PHONE_RE.test(phone);
}

// GET /api/whatsapp/conversaciones
router.get('/conversaciones', (req, res) => {
  try {
    const lista = svc.listarConversaciones();
    lista.sort((a, b) => {
      if (a.esperaRespuesta && !b.esperaRespuesta) return -1;
      if (!a.esperaRespuesta && b.esperaRespuesta) return 1;
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });
    res.json(lista);
  } catch (err) {
    console.error('[whatsapp/conversaciones]', err.message);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// GET /api/whatsapp/conversaciones/:phone
router.get('/conversaciones/:phone', (req, res) => {
  if (!validatePhone(req.params.phone)) {
    return res.status(400).json({ error: 'Número de teléfono inválido' });
  }
  try {
    const conv = svc.obtenerConversacion(req.params.phone);
    res.json(conv);
  } catch (err) {
    console.error('[whatsapp/conversaciones/:phone]', err.message);
    res.status(500).json({ error: 'Error al obtener conversación' });
  }
});

// POST /api/whatsapp/conversaciones/:phone/pausar
router.post('/conversaciones/:phone/pausar', (req, res) => {
  if (!validatePhone(req.params.phone)) {
    return res.status(400).json({ error: 'Número de teléfono inválido' });
  }
  try {
    const pausar = req.body.pausar !== false;
    const result = svc.togglePausa(req.params.phone, pausar);
    res.json(result);
  } catch (err) {
    console.error('[whatsapp/pausar]', err.message);
    res.status(500).json({ error: 'Error al actualizar pausa' });
  }
});

// GET /api/whatsapp/stats
router.get('/stats', (req, res) => {
  try {
    res.json(svc.estadisticas());
  } catch (err) {
    console.error('[whatsapp/stats]', err.message);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

module.exports = router;
