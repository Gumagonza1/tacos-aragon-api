/**
 * services/loyverse.js – Wrapper para la API de Loyverse v1.0
 */

const axios = require('axios');
const cfg   = require('../config');

const http = axios.create({
  baseURL: cfg.LOYVERSE_BASE,
  headers: { Authorization: `Bearer ${cfg.LOYVERSE_TOKEN}` },
  timeout: 15000,
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

/** Descarga todos los resultados paginados de un endpoint */
async function paginar(endpoint, params = {}) {
  const resultados = [];
  let cursor = null;
  do {
    const query = { limit: 250, ...params };
    if (cursor) query.cursor = cursor;
    const res  = await http.get(endpoint, { params: query });
    const data = res.data;
    const clave = Object.keys(data).find(k => Array.isArray(data[k]));
    if (clave) resultados.push(...data[clave]);
    cursor = data.cursor || null;
  } while (cursor);
  return resultados;
}

// ────────────────────────────────────────────────────────────────────────────
// API pública
// ────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene recibos filtrados por rango de fechas.
 * @param {string} desde  ISO date/datetime
 * @param {string} hasta  ISO date/datetime
 */
async function obtenerRecibos(desde, hasta) {
  return paginar('/receipts', {
    created_at_min: desde,
    created_at_max: hasta,
  });
}

/** Resumen del día actual */
async function resumenHoy() {
  const ahora   = new Date();
  const inicio  = new Date(ahora);
  inicio.setHours(0, 0, 0, 0);

  const recibos = await obtenerRecibos(inicio.toISOString(), ahora.toISOString());
  return calcularResumen(recibos);
}

/** Ventas agrupadas para gráficas */
async function ventasPorPeriodo(desde, hasta, agrupar = 'dia') {
  const recibos = await obtenerRecibos(desde, hasta);
  return agruparVentas(recibos, agrupar);
}

/** Recibos con filtros opcionales */
async function ventasFiltradas({ desde, hasta, tipo_pago, dining, employee_id, limit = 100, sin_reembolsos = false }) {
  const params = {
    created_at_min: desde,
    created_at_max: hasta,
    limit,
  };
  if (employee_id) params.employee_id = employee_id;

  let recibos = await paginar('/receipts', params);

  // Marcar reembolsos: Loyverse los devuelve con total_money < 0 y/o campo refund_for
  const numerosReembolsados = new Set(
    recibos.filter(r => r.refund_for).map(r => r.refund_for)
  );
  recibos = recibos.map(r => ({
    ...r,
    es_reembolso:  !!(r.refund_for || r.total_money < 0),
    reembolsado:   numerosReembolsados.has(r.receipt_number),
    canal:         resolverCanal(r),
  }));

  // Filtros client-side
  if (tipo_pago) {
    recibos = recibos.filter(r =>
      r.payments?.some(p => p.payment_type_id === tipo_pago)
    );
  }
  if (dining) {
    recibos = recibos.filter(r => r.canal.includes(dining.toLowerCase()));
  }
  if (sin_reembolsos) {
    recibos = recibos.filter(r => !r.es_reembolso && !r.reembolsado);
  }

  return recibos;
}

/** Lista de empleados */
async function obtenerEmpleados() {
  return paginar('/employees');
}

/** Lista de tipos de pago */
async function obtenerTiposPago() {
  const res = await http.get('/payment_types');
  return res.data.payment_types || [];
}

/** Obtiene un recibo por número para facturación */
async function obtenerRecibo(numero) {
  const res = await http.get(`/receipts/${numero}`);
  return res.data;
}

/** Items del catálogo */
async function obtenerItems() {
  return paginar('/items');
}

/**
 * Cierres de caja (shifts) con totales de efectivo, ventas netas, descuentos, etc.
 * @param {string} [desde]  ISO datetime (opened_at_min)
 * @param {string} [hasta]  ISO datetime (opened_at_max)
 */
async function obtenerShifts(desde, hasta) {
  const params = {};
  if (desde) params.created_at_min = desde;
  if (hasta) params.created_at_max = hasta;
  return paginar('/shifts', params);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers de cálculo
// ────────────────────────────────────────────────────────────────────────────

/**
 * Determina el canal de venta de un recibo.
 * Loyverse ignora el campo dining_option al guardar, así que el bot
 * escribe el tipo en la nota: "DOMICILIO | WA ..." o "RECOGER | WA ..."
 */
function resolverCanal(r) {
  if (r.dining_option) return r.dining_option.toLowerCase();
  const nota = (r.note || '').toUpperCase();
  if (nota.startsWith('DOMICILIO')) return 'domicilio';
  if (nota.startsWith('RECOGER'))   return 'recoger';
  return 'presencial';
}

function calcularResumen(recibos) {
  // Separar reembolsos (si ya vienen marcados del filtrado) o detectarlos aquí
  const numerosReembolsados = new Set(
    recibos.filter(r => r.refund_for).map(r => r.refund_for)
  );
  const ventas     = recibos.filter(r => !(r.es_reembolso ?? (r.refund_for || r.total_money < 0)));
  const reembolsos = recibos.filter(r =>   (r.es_reembolso ?? (r.refund_for || r.total_money < 0)));

  const totalBruto     = ventas.reduce((s, r) => s + (r.total_money || 0), 0);
  const totalReembolso = reembolsos.reduce((s, r) => s + Math.abs(r.total_money || 0), 0);
  const total          = totalBruto - totalReembolso;

  // Pedidos netos: ventas que no fueron reembolsadas
  const pedidosNetos = ventas.filter(r => !numerosReembolsados.has(r.receipt_number)).length;
  const ticket       = pedidosNetos > 0 ? total / pedidosNetos : 0;

  // Por tipo de pago (solo ventas, no reembolsos)
  const porPago = {};
  ventas.forEach(r => {
    (r.payments || []).forEach(p => {
      const id = p.payment_type_id || 'desconocido';
      porPago[id] = (porPago[id] || 0) + (p.money_amount || 0);
    });
  });

  // Por canal (dining_option o note del bot "DOMICILIO|WA..." / "RECOGER|WA...")
  // Solo ventas no reembolsadas
  const porCanal = {};
  ventas.filter(r => !numerosReembolsados.has(r.receipt_number)).forEach(r => {
    const canal = r.canal || resolverCanal(r);
    porCanal[canal] = (porCanal[canal] || 0) + 1;
  });

  // Top 5 productos (solo ventas netas)
  const prod = {};
  ventas.filter(r => !numerosReembolsados.has(r.receipt_number)).forEach(r => {
    (r.line_items || []).forEach(li => {
      const k = li.item_name || li.item_id;
      prod[k] = (prod[k] || 0) + (li.quantity || 1);
    });
  });
  const topProductos = Object.entries(prod)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, cantidad]) => ({ nombre, cantidad }));

  return {
    total,
    totalBruto,
    totalReembolso,
    pedidos:         pedidosNetos,
    reembolsosCount: reembolsos.length,
    ticketPromedio:  ticket,
    porPago,
    porCanal,
    topProductos,
  };
}

function agruparVentas(recibos, agrupar) {
  // Excluir reembolsos de las graficas (el total_money negativo ya los netea,
  // pero queremos que el conteo de pedidos no los incluya)
  const numerosReembolsados = new Set(
    recibos.filter(r => r.refund_for).map(r => r.refund_for)
  );
  const mapa = {};
  recibos.forEach(r => {
    const esReembolso = r.es_reembolso ?? (r.refund_for || r.total_money < 0);
    const fecha = new Date(r.receipt_date || r.created_at);
    let clave;
    if (agrupar === 'hora') {
      const horaLocal = (fecha.getUTCHours() - 7 + 24) % 24;
      clave = `${String(horaLocal).padStart(2, '0')}:00`;
    } else if (agrupar === 'semana') {
      const lunes = new Date(fecha);
      lunes.setDate(fecha.getDate() - fecha.getDay() + 1);
      clave = lunes.toISOString().slice(0, 10);
    } else if (agrupar === 'mes') {
      clave = fecha.toISOString().slice(0, 7);
    } else {
      clave = fecha.toISOString().slice(0, 10);
    }
    if (!mapa[clave]) mapa[clave] = { fecha: clave, total: 0, pedidos: 0 };
    // El total suma (los reembolsos tienen total negativo y se netean)
    mapa[clave].total += r.total_money || 0;
    // Pedidos: solo ventas netas (ni reembolso ni reembolsado)
    if (!esReembolso && !numerosReembolsados.has(r.receipt_number)) {
      mapa[clave].pedidos += 1;
    }
  });
  return Object.values(mapa).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

module.exports = {
  obtenerRecibos,
  resumenHoy,
  ventasPorPeriodo,
  ventasFiltradas,
  obtenerEmpleados,
  obtenerTiposPago,
  obtenerRecibo,
  obtenerItems,
  obtenerShifts,
  calcularResumen,
};
