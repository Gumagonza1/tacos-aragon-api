const router    = require('express').Router();
const facturama = require('../services/facturama');
const loyverse  = require('../services/loyverse');

const RFC_RE     = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
const CFDI_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const TICKET_RE  = /^[a-zA-Z0-9_-]{1,50}$/;

// GET /api/facturar/ticket/:numero – Obtiene datos del ticket para prellenar factura
router.get('/ticket/:numero', async (req, res) => {
  if (!TICKET_RE.test(req.params.numero)) {
    return res.status(400).json({ error: 'Número de ticket inválido' });
  }
  try {
    const recibo = await loyverse.obtenerRecibo(req.params.numero);
    res.json(recibo);
  } catch (err) {
    console.error('[facturar/ticket]', err.message);
    res.status(404).json({ error: 'Ticket no encontrado' });
  }
});

// GET /api/facturar/cliente/:rfc – Busca cliente en Facturama
router.get('/cliente/:rfc', async (req, res) => {
  const rfc = req.params.rfc.toUpperCase();
  if (!RFC_RE.test(rfc)) {
    return res.status(400).json({ error: 'RFC con formato inválido' });
  }
  try {
    const cliente = await facturama.buscarCliente(rfc);
    res.json(cliente);
  } catch (err) {
    console.error('[facturar/cliente]', err.message);
    res.status(404).json({ error: 'Cliente no encontrado en Facturama' });
  }
});

// POST /api/facturar – Timbra una factura
// Body: { ticket_numero, cliente: { rfc, nombre, email, codigoPostal, regimenFiscal, usoCFDI } }
router.post('/', async (req, res) => {
  try {
    const { ticket_numero, ticket_datos, cliente } = req.body;

    if (!cliente?.rfc || !cliente?.nombre) {
      return res.status(400).json({ error: 'Se requiere RFC y nombre del receptor' });
    }
    if (!RFC_RE.test(cliente.rfc.toUpperCase())) {
      return res.status(400).json({ error: 'RFC del receptor con formato inválido' });
    }
    if (ticket_numero && !TICKET_RE.test(ticket_numero)) {
      return res.status(400).json({ error: 'Número de ticket inválido' });
    }

    let ticket = ticket_datos;
    if (!ticket && ticket_numero) {
      ticket = await loyverse.obtenerRecibo(ticket_numero);
    }
    if (!ticket) {
      return res.status(400).json({ error: 'Se requiere ticket_numero o ticket_datos' });
    }

    const factura = await facturama.timbrarFactura(ticket, cliente);
    res.json(factura);
  } catch (err) {
    console.error('[facturar]', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al timbrar la factura' });
  }
});

// GET /api/facturar/lista?fechaInicio=&fechaFin=
router.get('/lista', async (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    const lista = await facturama.listarFacturas(fechaInicio, fechaFin);
    res.json(lista);
  } catch (err) {
    console.error('[facturar/lista]', err.message);
    res.status(500).json({ error: 'Error al obtener lista de facturas' });
  }
});

// GET /api/facturar/descargar/:cfdiId?formato=pdf|xml
router.get('/descargar/:cfdiId', async (req, res) => {
  if (!CFDI_ID_RE.test(req.params.cfdiId)) {
    return res.status(400).json({ error: 'ID de CFDI inválido' });
  }
  const formato = req.query.formato === 'xml' ? 'xml' : 'pdf';
  try {
    const buffer = await facturama.descargarFactura(req.params.cfdiId, formato);
    res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${req.params.cfdiId}.${formato}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[facturar/descargar]', err.message);
    res.status(500).json({ error: 'Error al descargar la factura' });
  }
});

module.exports = router;
