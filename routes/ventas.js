const router   = require('express').Router();
const loyverse = require('../services/loyverse');

// Zona horaria del negocio: GMT-7
const TZ_OFFSET_MS = -7 * 60 * 60 * 1000;

// ── Helpers de rango de fechas (siempre en GMT-7) ─────────────────────────────

function rangoHoy() {
  const ahoraUTC   = Date.now();
  const ahoraLocal = new Date(ahoraUTC + TZ_OFFSET_MS);
  const inicio     = new Date(ahoraLocal);
  inicio.setUTCHours(0, 0, 0, 0);
  return {
    desde: new Date(inicio.getTime() - TZ_OFFSET_MS).toISOString(),
    hasta: new Date(ahoraUTC).toISOString(),
  };
}

function rangoAyer() {
  const ahoraUTC   = Date.now();
  const ahoraLocal = new Date(ahoraUTC + TZ_OFFSET_MS);
  const inicio     = new Date(ahoraLocal);
  inicio.setUTCDate(ahoraLocal.getUTCDate() - 1);
  inicio.setUTCHours(0, 0, 0, 0);
  const fin = new Date(ahoraLocal);
  fin.setUTCDate(ahoraLocal.getUTCDate() - 1);
  fin.setUTCHours(23, 59, 59, 999);
  return {
    desde: new Date(inicio.getTime() - TZ_OFFSET_MS).toISOString(),
    hasta: new Date(fin.getTime() - TZ_OFFSET_MS).toISOString(),
  };
}

function rangoSemanaActual() {
  const ahoraUTC   = Date.now();
  const ahoraLocal = new Date(ahoraUTC + TZ_OFFSET_MS);
  const diaSemana  = ahoraLocal.getUTCDay(); // 0=dom … 6=sáb
  // El negocio abre martes–domingo; la semana arranca el martes
  const diasDesdeMartes = diaSemana >= 2 ? diaSemana - 2 : diaSemana + 5;
  const inicio = new Date(ahoraLocal);
  inicio.setUTCDate(ahoraLocal.getUTCDate() - diasDesdeMartes);
  inicio.setUTCHours(0, 0, 0, 0);
  return {
    desde: new Date(inicio.getTime() - TZ_OFFSET_MS).toISOString(),
    hasta: new Date(ahoraUTC).toISOString(),
  };
}

function rangoMes() {
  const ahoraUTC   = Date.now();
  const ahoraLocal = new Date(ahoraUTC + TZ_OFFSET_MS);
  const inicio     = new Date(ahoraLocal);
  inicio.setUTCDate(1);
  inicio.setUTCHours(0, 0, 0, 0);
  return {
    desde: new Date(inicio.getTime() - TZ_OFFSET_MS).toISOString(),
    hasta: new Date(ahoraUTC).toISOString(),
  };
}

/** Selecciona rango según periodo o usa fechas explícitas */
function seleccionarRango(periodo, desde, hasta, defaultDays = 7) {
  if (periodo === 'hoy')    return rangoHoy();
  if (periodo === 'ayer')   return rangoAyer();
  if (periodo === 'semana') return rangoSemanaActual();
  if (periodo === 'mes')    return rangoMes();
  const ahora    = new Date();
  const defDesde = new Date(ahora);
  defDesde.setDate(ahora.getDate() - defaultDays);
  return {
    desde: desde || defDesde.toISOString(),
    hasta: hasta || ahora.toISOString(),
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// GET /api/ventas?desde=&hasta=&periodo=hoy|ayer|semana|mes&tipo_pago=&dining=&employee_id=&limit=&sin_reembolsos=true
router.get('/', async (req, res) => {
  try {
    const { desde, hasta, periodo, tipo_pago, dining, employee_id, limit, sin_reembolsos } = req.query;
    const { desde: desdeEfectivo, hasta: hastaEfectivo } = seleccionarRango(periodo, desde, hasta, 7);

    const recibos = await loyverse.ventasFiltradas({
      desde:          desdeEfectivo,
      hasta:          hastaEfectivo,
      tipo_pago,
      dining,
      employee_id,
      limit:          parseInt(limit) || 250,
      sin_reembolsos: sin_reembolsos === 'true',
    });

    const resumen = loyverse.calcularResumen(recibos);
    res.json({ recibos, resumen, total: recibos.length });
  } catch (err) {
    console.error('[ventas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/grafica?periodo=hoy|ayer|semana|mes&desde=&hasta=&agrupar=dia|hora|semana|mes
router.get('/grafica', async (req, res) => {
  try {
    const { desde, hasta, agrupar = 'dia', periodo } = req.query;
    const { desde: desdeEfectivo, hasta: hastaEfectivo } = seleccionarRango(periodo, desde, hasta, 29);

    const datos = await loyverse.ventasPorPeriodo(desdeEfectivo, hastaEfectivo, agrupar);
    res.json(datos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/resumen?periodo=hoy|ayer|semana|mes&desde=&hasta=
// Resumen limpio sin array de recibos; porPago con nombres legibles, no UUIDs.
// Endpoint preferido para el monitor/agente.
router.get('/resumen', async (req, res) => {
  try {
    const { desde, hasta, periodo } = req.query;
    const { desde: desdeEfectivo, hasta: hastaEfectivo } = seleccionarRango(periodo, desde, hasta, 7);

    const [recibos, tiposPago] = await Promise.all([
      loyverse.ventasFiltradas({ desde: desdeEfectivo, hasta: hastaEfectivo, limit: 250 }),
      loyverse.obtenerTiposPago(),
    ]);

    const resumen = loyverse.calcularResumen(recibos);

    // Resolver UUIDs de pago a nombres legibles
    const pagoMap = {};
    tiposPago.forEach(t => { pagoMap[t.id] = t.name; });
    const porPagoNombres = {};
    Object.entries(resumen.porPago).forEach(([id, monto]) => {
      porPagoNombres[pagoMap[id] || id] = Math.round(monto * 100) / 100;
    });

    res.json({
      periodo:         { desde: desdeEfectivo.slice(0, 10), hasta: hastaEfectivo.slice(0, 10) },
      total:           Math.round(resumen.total * 100) / 100,
      totalBruto:      Math.round(resumen.totalBruto * 100) / 100,
      totalReembolso:  Math.round(resumen.totalReembolso * 100) / 100,
      pedidos:         resumen.pedidos,
      reembolsos:      resumen.reembolsosCount,
      ticketPromedio:  Math.round(resumen.ticketPromedio * 100) / 100,
      porPago:         porPagoNombres,
      porCanal:        resumen.porCanal,
      topProductos:    resumen.topProductos,
    });
  } catch (err) {
    console.error('[ventas/resumen]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/empleados-ventas?periodo=hoy|ayer|semana|mes&desde=&hasta=
// Ventas y pedidos agrupados por empleado en una sola llamada.
router.get('/empleados-ventas', async (req, res) => {
  try {
    const { desde, hasta, periodo } = req.query;
    const { desde: desdeEfectivo, hasta: hastaEfectivo } = seleccionarRango(periodo, desde, hasta, 7);

    const [empleados, recibos] = await Promise.all([
      loyverse.obtenerEmpleados(),
      loyverse.ventasFiltradas({ desde: desdeEfectivo, hasta: hastaEfectivo, limit: 250, sin_reembolsos: true }),
    ]);

    const empleadoMap = {};
    empleados.forEach(e => { empleadoMap[e.id] = e.name; });

    const ventasPorEmp = {};
    recibos.forEach(r => {
      const nombre = empleadoMap[r.employee_id] || 'Sin asignar';
      if (!ventasPorEmp[nombre]) ventasPorEmp[nombre] = { pedidos: 0, total: 0 };
      ventasPorEmp[nombre].pedidos += 1;
      ventasPorEmp[nombre].total   += r.total_money || 0;
    });

    const ranking = Object.entries(ventasPorEmp)
      .map(([nombre, d]) => ({ nombre, pedidos: d.pedidos, total: Math.round(d.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    res.json({
      periodo:   { desde: desdeEfectivo.slice(0, 10), hasta: hastaEfectivo.slice(0, 10) },
      empleados: ranking,
    });
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

// GET /api/ventas/por-producto?nombre=domicilio&periodo=hoy|ayer|semana|mes&desde=&hasta=
router.get('/por-producto', async (req, res) => {
  try {
    const { nombre, desde, hasta, periodo } = req.query;
    if (!nombre) return res.status(400).json({ error: 'Parámetro "nombre" requerido' });

    const { desde: desdeEfectivo, hasta: hastaEfectivo } = seleccionarRango(periodo, desde, hasta, 7);

    const recibos = await loyverse.ventasFiltradas({
      desde: desdeEfectivo,
      hasta: hastaEfectivo,
      limit: 250,
      sin_reembolsos: true,
    });

    const patron      = nombre.toLowerCase();
    const coincidencias = [];
    let totalCantidad = 0;
    let totalDinero   = 0;

    recibos.forEach(r => {
      (r.line_items || []).forEach(li => {
        if ((li.item_name || '').toLowerCase().includes(patron)) {
          coincidencias.push({
            fecha:    r.created_at?.slice(0, 10),
            ticket:   r.receipt_number,
            producto: li.item_name,
            cantidad: li.quantity || 1,
            precio:   li.price || 0,
            subtotal: li.gross_total_money || 0,
          });
          totalCantidad += li.quantity || 1;
          totalDinero   += li.gross_total_money || 0;
        }
      });
    });

    res.json({
      busqueda:       nombre,
      periodo:        { desde: desdeEfectivo.slice(0, 10), hasta: hastaEfectivo.slice(0, 10) },
      total_cantidad: totalCantidad,
      total_dinero:   Math.round(totalDinero * 100) / 100,
      coincidencias,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/cierres?periodo=hoy|ayer|semana|mes&desde=&hasta=
// Cierres de caja (shifts) con totales de efectivo, ventas netas, descuentos y movimientos.
router.get('/cierres', async (req, res) => {
  try {
    const { desde, hasta, periodo } = req.query;
    const { desde: desdeEfectivo, hasta: hastaEfectivo } = seleccionarRango(periodo, desde, hasta, 7);

    const [shifts, empleados] = await Promise.all([
      loyverse.obtenerShifts(desdeEfectivo, hastaEfectivo),
      loyverse.obtenerEmpleados(),
    ]);

    const empMap = {};
    empleados.forEach(e => { empMap[e.id] = e.name; });

    const cierres = shifts.map(s => ({
      id:             s.id,
      apertura:       s.opened_at,
      cierre:         s.closed_at,
      abierto_por:    empMap[s.opened_by_employee] || s.opened_by_employee || 'Desconocido',
      cerrado_por:    empMap[s.closed_by_employee] || s.closed_by_employee || 'Abierto',
      caja_inicial:   s.starting_cash    || 0,
      pagos_efectivo: s.cash_payments    || 0,
      entradas:       s.paid_in          || 0,
      salidas:        s.paid_out         || 0,
      efectivo_esperado: s.expected_cash || 0,
      efectivo_real:     s.actual_cash   || 0,
      diferencia:     ((s.actual_cash || 0) - (s.expected_cash || 0)),
      ventas_brutas:  s.gross_sales      || 0,
      reembolsos:     s.refunds          || 0,
      descuentos:     s.discounts        || 0,
      ventas_netas:   s.net_sales        || 0,
      propinas:       s.tip              || 0,
      impuestos:      s.taxes            || 0,
      pagos:          s.payments         || [],
      movimientos_caja: (s.cash_movements || []).map(m => ({
        tipo:    m.payment_type,
        monto:   m.money_amount,
        nota:    m.note,
        hora:    m.created_at,
      })),
    }));

    // Totales acumulados del periodo
    const totales = cierres.reduce((acc, c) => ({
      ventas_netas:   acc.ventas_netas   + c.ventas_netas,
      descuentos:     acc.descuentos     + c.descuentos,
      reembolsos:     acc.reembolsos     + c.reembolsos,
      diferencia_caja: acc.diferencia_caja + c.diferencia,
    }), { ventas_netas: 0, descuentos: 0, reembolsos: 0, diferencia_caja: 0 });

    res.json({
      periodo:    { desde: desdeEfectivo.slice(0, 10), hasta: hastaEfectivo.slice(0, 10) },
      total_cierres: cierres.length,
      totales:    {
        ventas_netas:    Math.round(totales.ventas_netas   * 100) / 100,
        descuentos:      Math.round(totales.descuentos     * 100) / 100,
        reembolsos:      Math.round(totales.reembolsos     * 100) / 100,
        diferencia_caja: Math.round(totales.diferencia_caja * 100) / 100,
      },
      cierres,
    });
  } catch (err) {
    console.error('[ventas/cierres]', err.message);
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
