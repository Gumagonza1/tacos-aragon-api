const router   = require('express').Router();
const loyverse = require('../services/loyverse');

// Zona horaria del negocio: GMT-7
const TZ_OFFSET_MS = -7 * 60 * 60 * 1000;

// GET /api/dashboard – Resumen completo: hoy, semana (mar–hoy), mes; gráficas
router.get('/', async (req, res) => {
  try {
    const ahoraUTC   = Date.now();
    const ahoraLocal = new Date(ahoraUTC + TZ_OFFSET_MS);
    const ahoraISO   = new Date(ahoraUTC).toISOString();

    // Hoy GMT-7
    const inicioHoyLocal = new Date(ahoraLocal);
    inicioHoyLocal.setUTCHours(0, 0, 0, 0);
    const inicioHoyISO = new Date(inicioHoyLocal.getTime() - TZ_OFFSET_MS).toISOString();

    // Semana mar–hoy GMT-7
    const diaSemana       = ahoraLocal.getUTCDay();
    const diasDesdeMartes = diaSemana >= 2 ? diaSemana - 2 : diaSemana + 5;
    const inicioSemanaLocal = new Date(ahoraLocal);
    inicioSemanaLocal.setUTCDate(ahoraLocal.getUTCDate() - diasDesdeMartes);
    inicioSemanaLocal.setUTCHours(0, 0, 0, 0);
    const inicioSemanaISO = new Date(inicioSemanaLocal.getTime() - TZ_OFFSET_MS).toISOString();

    // Mes GMT-7
    const inicioMesLocal = new Date(ahoraLocal);
    inicioMesLocal.setUTCDate(1);
    inicioMesLocal.setUTCHours(0, 0, 0, 0);
    const inicioMesISO = new Date(inicioMesLocal.getTime() - TZ_OFFSET_MS).toISOString();

    const [recibosHoy, recibosSem, recibosMes] = await Promise.all([
      loyverse.obtenerRecibos(inicioHoyISO, ahoraISO),
      loyverse.obtenerRecibos(inicioSemanaISO, ahoraISO),
      loyverse.obtenerRecibos(inicioMesISO, ahoraISO),
    ]);

    const [graficaSemana, graficaHoras] = await Promise.all([
      loyverse.ventasPorPeriodo(inicioSemanaISO, ahoraISO, 'dia'),
      loyverse.ventasPorPeriodo(inicioHoyISO, ahoraISO, 'hora'),
    ]);

    res.json({
      timestamp: ahoraISO,
      hoy:       loyverse.calcularResumen(recibosHoy),
      semana:    loyverse.calcularResumen(recibosSem),
      mes:       loyverse.calcularResumen(recibosMes),
      graficas: {
        semana: graficaSemana,
        horas:  graficaHoras,
      },
    });
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: 'Error al obtener el dashboard' });
  }
});

module.exports = router;
