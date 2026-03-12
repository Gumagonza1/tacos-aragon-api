const router = require('express').Router();
const svc    = require('../services/whatsapp');

// GET /api/whatsapp/conversaciones
router.get('/conversaciones', (req, res) => {
  try {
    const lista = svc.listarConversaciones();
    // Ordenar: primero las que esperan respuesta, luego por timestamp desc
    lista.sort((a, b) => {
      if (a.esperaRespuesta && !b.esperaRespuesta) return -1;
      if (!a.esperaRespuesta && b.esperaRespuesta) return 1;
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whatsapp/conversaciones/:phone
router.get('/conversaciones/:phone', (req, res) => {
  try {
    const conv = svc.obtenerConversacion(req.params.phone);
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/conversaciones/:phone/pausar
router.post('/conversaciones/:phone/pausar', (req, res) => {
  try {
    const { pausar = true } = req.body;
    const result = svc.togglePausa(req.params.phone, pausar);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whatsapp/stats
router.get('/stats', (req, res) => {
  try {
    res.json(svc.estadisticas());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
