/**
 * routes/contabilidad.js
 * Gestión de movimientos pendientes de catalogar (generados por el job nocturno).
 * Los registros resueltos se crean directamente en el CFO Agent (puerto 3002).
 */

const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');

const CFO_BASE  = process.env.CFO_BASE;
const CFO_TOKEN = process.env.CFO_TOKEN;

if (!CFO_BASE || !CFO_TOKEN) {
  console.error('[contabilidad] ERROR: CFO_BASE y CFO_TOKEN son requeridos en las variables de entorno.');
  process.exit(1);
}
const PENDIENTES_PATH = path.join(__dirname, '../datos/pendientes_contabilidad.json');

const TIPOS_INGRESO = ['ventas', 'otros'];
const TIPOS_GASTO   = ['nomina', 'insumos', 'servicios', 'otros'];
const MAX_CONCEPTO  = 200;

function leerPendientes() {
  try { return JSON.parse(fs.readFileSync(PENDIENTES_PATH, 'utf8')); }
  catch { return []; }
}

function escribirPendientes(lista) {
  fs.mkdirSync(path.dirname(PENDIENTES_PATH), { recursive: true });
  fs.writeFileSync(PENDIENTES_PATH, JSON.stringify(lista, null, 2), 'utf8');
}

// GET /api/contabilidad/pendientes
router.get('/pendientes', (req, res) => {
  res.json(leerPendientes());
});

// POST /api/contabilidad/pendientes/resolver
// Body: { idx, accion: 'ingreso'|'gasto'|'ignorar', tipo, concepto, deducible? }
router.post('/pendientes/resolver', async (req, res) => {
  const { idx, accion, tipo, concepto, deducible = 1 } = req.body;
  if (idx === undefined || !accion) return res.status(400).json({ error: 'idx y accion requeridos' });
  if (!['ingreso', 'gasto', 'ignorar'].includes(accion)) {
    return res.status(400).json({ error: 'accion inválida' });
  }
  if (concepto !== undefined) {
    if (typeof concepto !== 'string' || concepto.length > MAX_CONCEPTO) {
      return res.status(400).json({ error: 'concepto inválido o demasiado largo' });
    }
  }
  if (accion === 'ingreso' && tipo && !TIPOS_INGRESO.includes(tipo)) {
    return res.status(400).json({ error: 'tipo de ingreso inválido' });
  }
  if (accion === 'gasto' && tipo && !TIPOS_GASTO.includes(tipo)) {
    return res.status(400).json({ error: 'tipo de gasto inválido' });
  }

  const lista = leerPendientes();
  const idxNum = parseInt(idx);
  if (isNaN(idxNum) || idxNum < 0 || idxNum >= lista.length) {
    return res.status(404).json({ error: 'índice fuera de rango' });
  }

  const item = lista[idxNum];

  try {
    if (accion === 'ingreso') {
      await axios.post(`${CFO_BASE}/api/contabilidad/ingresos`, {
        fecha:    item.fecha,
        concepto: concepto || `${item.comentario} – ${item.fecha}`,
        tipo:     tipo || 'ventas',
        monto:    item.monto,
        notas:    `Catalogado manualmente desde app. Origen: ${item.tipo_movimiento} "${item.comentario}" ${item.hora}`,
      }, { headers: { 'x-api-token': CFO_TOKEN }, timeout: 15000 });

    } else if (accion === 'gasto') {
      await axios.post(`${CFO_BASE}/api/contabilidad/gastos`, {
        fecha:     item.fecha,
        concepto:  concepto || `${item.comentario} – ${item.fecha}`,
        tipo:      tipo || 'otros',
        monto:     item.monto,
        deducible: deducible ? 1 : 0,
        notas:     `Catalogado manualmente desde app. Origen: ${item.tipo_movimiento} "${item.comentario}" ${item.hora}`,
      }, { headers: { 'x-api-token': CFO_TOKEN }, timeout: 15000 });

    }
    // 'ignorar' no crea registro, solo elimina

    lista.splice(idxNum, 1);
    escribirPendientes(lista);
    res.json({ ok: true, restantes: lista.length });

  } catch (e) {
    console.error('[contabilidad/resolver]', e.message);
    res.status(500).json({ error: 'Error al registrar el movimiento' });
  }
});

// DELETE /api/contabilidad/pendientes/:idx  (ignorar sin crear registro)
router.delete('/pendientes/:idx', (req, res) => {
  const idx = parseInt(req.params.idx);
  const lista = leerPendientes();
  if (isNaN(idx) || idx < 0 || idx >= lista.length) return res.status(404).json({ error: 'índice no encontrado' });
  lista.splice(idx, 1);
  escribirPendientes(lista);
  res.json({ ok: true, restantes: lista.length });
});

// ─── Proxy rutas CFO de contabilidad (ingresos, gastos, balance, chat, etc.) ──

router.all('*', async (req, res) => {
  try {
    const { data, status, headers } = await axios({
      method:  req.method,
      url:     `${CFO_BASE}${req.originalUrl}`,
      headers: { 'x-api-token': CFO_TOKEN },
      data:    req.body,
      timeout: 300000,
      maxBodyLength:    Infinity,
      maxContentLength: Infinity,
    });
    const ct = headers['content-type'];
    if (ct) res.set('Content-Type', ct);
    res.status(status).send(data);
  } catch (err) {
    const r = err.response;
    if (r) res.status(r.status).send(r.data);
    else res.status(502).json({ error: 'CFO agent no disponible' });
  }
});

module.exports = router;
