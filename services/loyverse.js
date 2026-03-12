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
async function ventasFiltradas({ desde, hasta, tipo_pago, dining, employee_id, limit = 100 }) {
  const params = {
    created_at_min: desde,
    created_at_max: hasta,
    limit,
  };
  if (employee_id) params.employee_id = employee_id;

  let recibos = await paginar('/receipts', params);

  // Filtros client-side (Loyverse no los soporta todos en query)
  if (tipo_pago) {
    recibos = recibos.filter(r =>
      r.payments?.some(p => p.payment_type_id === tipo_pago)
    );
  }
  if (dining) {
    recibos = recibos.filter(r =>
      (r.dining_option || '').toLowerCase().includes(dining.toLowerCase())
    );
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

// ────────────────────────────────────────────────────────────────────────────
// Helpers de cálculo
// ────────────────────────────────────────────────────────────────────────────

function calcularResumen(recibos) {
  const total    = recibos.reduce((s, r) => s + (r.total_money || 0), 0);
  const pedidos  = recibos.length;
  const ticket   = pedidos > 0 ? total / pedidos : 0;

  // Por tipo de pago
  const porPago = {};
  recibos.forEach(r => {
    (r.payments || []).forEach(p => {
      const id = p.payment_type_id || 'desconocido';
      porPago[id] = (porPago[id] || 0) + (p.money_amount || 0);
    });
  });

  // Por canal (dining_option)
  const porCanal = {};
  recibos.forEach(r => {
    const canal = r.dining_option || 'presencial';
    porCanal[canal] = (porCanal[canal] || 0) + 1;
  });

  // Top 5 productos
  const prod = {};
  recibos.forEach(r => {
    (r.line_items || []).forEach(li => {
      const k = li.item_name || li.item_id;
      prod[k] = (prod[k] || 0) + (li.quantity || 1);
    });
  });
  const topProductos = Object.entries(prod)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, cantidad]) => ({ nombre, cantidad }));

  return { total, pedidos, ticketPromedio: ticket, porPago, porCanal, topProductos };
}

function agruparVentas(recibos, agrupar) {
  const mapa = {};
  recibos.forEach(r => {
    const fecha = new Date(r.receipt_date || r.created_at);
    let clave;
    if (agrupar === 'hora') {
      // Convertir UTC → GMT-7 para que las horas coincidan con la zona del negocio
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
    mapa[clave].total   += r.total_money || 0;
    mapa[clave].pedidos += 1;
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
  calcularResumen,
};
