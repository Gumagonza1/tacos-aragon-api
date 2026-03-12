const router    = require('express').Router();
const facturama = require('../services/facturama');
const loyverse  = require('../services/loyverse');

// GET /api/facturar/ticket/:numero – Obtiene datos del ticket para prellenar factura
router.get('/ticket/:numero', async (req, res) => {
  try {
    const recibo = await loyverse.obtenerRecibo(req.params.numero);
    res.json(recibo);
  } catch (err) {
    res.status(404).json({ error: 'Ticket no encontrado' });
  }
});

// GET /api/facturar/cliente/:rfc – Busca cliente en Facturama
router.get('/cliente/:rfc', async (req, res) => {
  try {
    const cliente = await facturama.buscarCliente(req.params.rfc.toUpperCase());
    res.json(cliente);
  } catch {
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

    // Si se pasan datos del ticket directamente (desde la app) o buscarlos en Loyverse
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
    res.status(500).json({ error: err.response?.data?.Details || err.message });
  }
});

// GET /api/facturar/lista?fechaInicio=&fechaFin=
router.get('/lista', async (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    const lista = await facturama.listarFacturas(fechaInicio, fechaFin);
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/facturar/descargar/:cfdiId?formato=pdf|xml
router.get('/descargar/:cfdiId', async (req, res) => {
  try {
    const { formato = 'pdf' } = req.query;
    const buffer = await facturama.descargarFactura(req.params.cfdiId, formato);
    res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${req.params.cfdiId}.${formato}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
