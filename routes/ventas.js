const router   = require('express').Router();
const loyverse = require('../services/loyverse');

// GET /api/ventas?desde=&hasta=&tipo_pago=&dining=&employee_id=&limit=
router.get('/', async (req, res) => {
  try {
    const { desde, hasta, tipo_pago, dining, employee_id, limit } = req.query;

    const ahora   = new Date();
    const defDesde = new Date(ahora);
    defDesde.setDate(ahora.getDate() - 7);

    const recibos = await loyverse.ventasFiltradas({
      desde:       desde || defDesde.toISOString(),
      hasta:       hasta || ahora.toISOString(),
      tipo_pago,
      dining,
      employee_id,
      limit:       parseInt(limit) || 250,
    });

    const resumen = loyverse.calcularResumen(recibos);

    res.json({ recibos, resumen, total: recibos.length });
  } catch (err) {
    console.error('[ventas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/grafica?desde=&hasta=&agrupar=dia|hora|semana|mes
router.get('/grafica', async (req, res) => {
  try {
    const { desde, hasta, agrupar = 'dia' } = req.query;
    const ahora   = new Date();
    const defDesde = new Date(ahora);
    defDesde.setDate(ahora.getDate() - 29);

    const datos = await loyverse.ventasPorPeriodo(
      desde || defDesde.toISOString(),
      hasta || ahora.toISOString(),
      agrupar,
    );
    res.json(datos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/empleados
router.get('/empleados', async (req, res) => {
  try {
    const empleados = await loyverse.obtenerEmpleados();
    res.json(empleados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/tipos-pago
router.get('/tipos-pago', async (req, res) => {
  try {
    const tipos = await loyverse.obtenerTiposPago();
    res.json(tipos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/ticket/:numero
router.get('/ticket/:numero', async (req, res) => {
  try {
    const recibo = await loyverse.obtenerRecibo(req.params.numero);
    res.json(recibo);
  } catch (err) {
    res.status(404).json({ error: 'Ticket no encontrado' });
  }
});

module.exports = router;
