/**
 * services/facturama.js – Integración con Facturama PAC (Node.js).
 * Timbra CFDIs 4.0 a partir de datos de ticket de Loyverse.
 */

const axios = require('axios');
const cfg   = require('../config');

const BASE = cfg.FACTURAMA_SANDBOX
  ? 'https://apisandbox.facturama.mx'
  : 'https://api.facturama.mx';

function http() {
  return axios.create({
    baseURL: BASE,
    auth: { username: cfg.FACTURAMA_USER, password: cfg.FACTURAMA_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
  });
}

/**
 * Busca un cliente por RFC en Facturama.
 */
async function buscarCliente(rfc) {
  const res = await http().get(`/api/Clients/${rfc}`);
  return res.data;
}

/**
 * Crea un cliente en Facturama si no existe.
 */
async function crearCliente(datos) {
  const res = await http().post('/api/Clients', datos);
  return res.data;
}

/**
 * Construye el payload CFDI 4.0 a partir de los datos del ticket de Loyverse.
 *
 * @param {Object} ticket      Datos del recibo de Loyverse
 * @param {Object} cliente     { rfc, nombre, email, codigoPostal, regimenFiscal, usoCFDI }
 */
function construirCFDI(ticket, cliente) {
  const subtotal = ticket.total_money / 1.16;
  const iva      = ticket.total_money - subtotal;

  const conceptos = (ticket.line_items || []).map(li => ({
    Quantity: li.quantity || 1,
    ProductCode: '90101501',        // Código SAT para alimentos preparados
    UnitCode: 'H87',                 // Pieza
    Unit: 'Pieza',
    Description: li.item_name || 'Producto',
    IdentificationNumber: li.item_id || '',
    UnitPrice: parseFloat(((li.price || 0) / 1.16).toFixed(6)),
    Subtotal: parseFloat(((li.total_money || 0) / 1.16).toFixed(6)),
    TaxObject: '02',
    Taxes: [
      {
        Total: parseFloat((li.total_money - li.total_money / 1.16).toFixed(6)),
        Name: 'IVA',
        Base: parseFloat(((li.total_money || 0) / 1.16).toFixed(6)),
        Rate: 0.16,
        IsRetention: false,
      },
    ],
    Total: parseFloat((li.total_money || 0).toFixed(6)),
  }));

  return {
    Folio: ticket.receipt_number?.toString() || '',
    Date: new Date(ticket.receipt_date || Date.now()).toISOString().slice(0, 19),
    PaymentForm: '01',              // Efectivo por defecto
    PaymentMethod: 'PUE',
    Currency: 'MXN',
    Subtotal: parseFloat(subtotal.toFixed(6)),
    Discount: 0,
    Observations: `Folio: ${ticket.receipt_number || ''}`,
    Issuer: {
      FiscalRegime: '612',
      Rfc: process.env.EMISOR_RFC || '',
      Name: process.env.EMISOR_NOMBRE || 'Tacos Aragón',
    },
    Receiver: {
      Rfc: cliente.rfc,
      Name: cliente.nombre,
      CfdiUse: cliente.usoCFDI || 'G03',
      Email: cliente.email || '',
      FiscalRegime: cliente.regimenFiscal || '616',
      TaxZipCode: cliente.codigoPostal || '80000',
    },
    Items: conceptos,
  };
}

/**
 * Timbra una factura en Facturama.
 *
 * @param {Object} ticket   Recibo de Loyverse
 * @param {Object} cliente  Datos del receptor de la factura
 */
async function timbrarFactura(ticket, cliente) {
  const cfdi = construirCFDI(ticket, cliente);
  const res  = await http().post('/api/3/cfdis', cfdi);
  return res.data;
}

/**
 * Descarga el PDF/XML de una factura ya timbrada.
 */
async function descargarFactura(cfdiId, formato = 'pdf') {
  const res = await http().get(`/cfdi/${formato}/issuedLite/${cfdiId}`, {
    responseType: 'arraybuffer',
  });
  return Buffer.from(res.data);
}

/**
 * Lista facturas emitidas con filtro de fecha.
 */
async function listarFacturas(fechaInicio, fechaFin) {
  const params = {};
  if (fechaInicio) params['dateStart'] = fechaInicio;
  if (fechaFin)    params['dateEnd']   = fechaFin;
  const res = await http().get('/api/lite/issuedCfdis', { params });
  return res.data || [];
}

module.exports = { buscarCliente, crearCliente, timbrarFactura, descargarFactura, listarFacturas };
