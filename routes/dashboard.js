const router   = require('express').Router();
const loyverse = require('../services/loyverse');

// GET /api/dashboard – Resumen completo del negocio para la pantalla principal
router.get('/', async (req, res) => {
  try {
    const ahora = new Date();

    // Hoy
    const inicioHoy = new Date(ahora);
    inicioHoy.setHours(0, 0, 0, 0);
    const recibosHoy  = await loyverse.obtenerRecibos(inicioHoy.toISOString(), ahora.toISOString());
    const resumenHoy  = loyverse.calcularResumen(recibosHoy);

    // Semana actual (últimos 7 días)
    const inicioSemana = new Date(ahora);
    inicioSemana.setDate(ahora.getDate() - 6);
    inicioSemana.setHours(0, 0, 0, 0);
    const recibosSem  = await loyverse.obtenerRecibos(inicioSemana.toISOString(), ahora.toISOString());
    const resumenSem  = loyverse.calcularResumen(recibosSem);

    // Mes actual
    const inicioMes   = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const recibosMes  = await loyverse.obtenerRecibos(inicioMes.toISOString(), ahora.toISOString());
    const resumenMes  = loyverse.calcularResumen(recibosMes);

    // Gráfica de últimos 7 días (por día)
    const graficaSemana = await loyverse.ventasPorPeriodo(inicioSemana.toISOString(), ahora.toISOString(), 'dia');

    // Gráfica de ventas por hora hoy
    const graficaHoras = await loyverse.ventasPorPeriodo(inicioHoy.toISOString(), ahora.toISOString(), 'hora');

    res.json({
      timestamp: ahora.toISOString(),
      hoy:       resumenHoy,
      semana:    resumenSem,
      mes:       resumenMes,
      graficas: {
        semana: graficaSemana,
        horas:  graficaHoras,
      },
    });
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
