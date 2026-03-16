/**
 * jobs/prellenar_contabilidad.js
 *
 * Corre a las 2:05 AM GMT-7 (09:05 UTC) de martes a domingo.
 *
 * INGRESOS (desde recibos de Loyverse):
 *   - Efectivo + WhatsApp + TC + TA → "Efectivo"
 *   - Transferencia, Tarjeta, Link de pago → su propio tipo
 *
 * INGRESOS EXTRA (desde movimientos de caja PAY_IN):
 *   - Comentario "tc" o "ta" → ingreso "Ventas apps (TC/TA)" tipo efectivo
 *
 * GASTOS (desde movimientos de caja PAY_OUT, auto-catalogados):
 *   - Comentario contiene "compra"  → gasto tipo "materia_prima"
 *   - Comentario contiene "nomina" o "nómina" → gasto tipo "nomina"
 *
 * NO CATALOGADOS:
 *   - Todo movimiento que no encaje → guardado en datos/pendientes_contabilidad.json
 *     para que el dueño los catalogue manualmente desde la app.
 *
 * Prueba manual:
 *   node jobs/prellenar_contabilidad.js --now
 *   node jobs/prellenar_contabilidad.js --fecha 2026-03-15
 */

const cron     = require('node-cron');
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const cfg      = require('../config');
const loyverse = require('../services/loyverse');

const CFO_BASE  = process.env.CFO_BASE;
const CFO_TOKEN = process.env.CFO_TOKEN;

if (!CFO_BASE || !CFO_TOKEN) {
  console.error('[prellenar_contabilidad] ERROR: CFO_BASE y CFO_TOKEN son requeridos en las variables de entorno.');
  process.exit(1);
}

const TZ_OFFSET_MS = -7 * 60 * 60 * 1000;

// Archivo donde se guardan movimientos pendientes de catalogar manualmente
const PENDIENTES_PATH = path.join(__dirname, '../datos/pendientes_contabilidad.json');

// ── Normalización de tipos de pago ───────────────────────────────────────────
// TC y TA siempre se suman a Efectivo (apps de delivery que pagan en mano)
const SIEMPRE_EFECTIVO = ['tc', 'ta'];

// WhatsApp queda como pendiente: el dueño decide a qué tipo asignarlo
const REQUIEREN_DECISION = ['whatsapp'];

function normalizarTipo(nombre) {
  if (SIEMPRE_EFECTIVO.includes((nombre || '').toLowerCase())) return 'Efectivo';
  return nombre;
}

function requiereDecision(nombre) {
  return REQUIEREN_DECISION.includes((nombre || '').toLowerCase());
}

// ── Auto-catalogación de movimientos de caja ─────────────────────────────────
function clasificarMovimiento(mov) {
  const comentario = (mov.comment || '').toLowerCase().trim();
  const monto      = mov.money_amount || 0;
  const tipo       = mov.type; // 'PAY_IN' | 'PAY_OUT'

  if (tipo === 'PAY_IN') {
    if (['tc', 'ta'].includes(comentario)) {
      return { accion: 'ingreso', concepto: `Ventas apps (${mov.comment}) ${mov.fecha}`, tipo: 'ventas', monto };
    }
    return { accion: 'pendiente', razon: `PAY_IN sin categoría: "${mov.comment}" $${monto}` };
  }

  if (tipo === 'PAY_OUT') {
    if (comentario.includes('compra')) {
      return { accion: 'gasto', concepto: `Compra materiales – ${mov.comment}`, tipo: 'materia_prima', monto };
    }
    if (comentario.includes('nomina') || comentario.includes('nómina')) {
      return { accion: 'gasto', concepto: `Nómina – ${mov.comment}`, tipo: 'nomina', monto };
    }
    return { accion: 'pendiente', razon: `PAY_OUT sin categoría: "${mov.comment}" $${monto}` };
  }

  return { accion: 'pendiente', razon: `Movimiento desconocido: ${tipo} "${mov.comment}" $${monto}` };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rangoDia(fechaLocal) {
  if (fechaLocal) {
    const inicio = new Date(`${fechaLocal}T00:00:00.000Z`);
    const fin    = new Date(`${fechaLocal}T23:59:59.999Z`);
    return {
      desde: new Date(inicio.getTime() - TZ_OFFSET_MS).toISOString(),
      hasta: new Date(fin.getTime()    - TZ_OFFSET_MS).toISOString(),
      fecha: fechaLocal,
    };
  }
  const ahoraUTC   = Date.now();
  const ahoraLocal = new Date(ahoraUTC + TZ_OFFSET_MS);
  const inicio = new Date(ahoraLocal);
  inicio.setUTCDate(ahoraLocal.getUTCDate() - 1);
  inicio.setUTCHours(0, 0, 0, 0);
  const fin = new Date(ahoraLocal);
  fin.setUTCDate(ahoraLocal.getUTCDate() - 1);
  fin.setUTCHours(23, 59, 59, 999);
  return {
    desde: new Date(inicio.getTime() - TZ_OFFSET_MS).toISOString(),
    hasta: new Date(fin.getTime()    - TZ_OFFSET_MS).toISOString(),
    fecha: inicio.toISOString().slice(0, 10),
  };
}

async function crearIngreso(payload) {
  const resp = await axios.post(`${CFO_BASE}/api/contabilidad/ingresos`, payload, {
    headers: { 'x-api-token': CFO_TOKEN, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return resp.data;
}

async function crearGasto(payload) {
  const resp = await axios.post(`${CFO_BASE}/api/contabilidad/gastos`, payload, {
    headers: { 'x-api-token': CFO_TOKEN, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return resp.data;
}

function guardarPendientes(fecha, nuevos) {
  let existentes = [];
  try { existentes = JSON.parse(fs.readFileSync(PENDIENTES_PATH, 'utf8')); } catch {}
  existentes = existentes.filter(p => p.fecha !== fecha);
  const todos = [...existentes, ...nuevos.map(p => ({ ...p, fecha }))];
  fs.mkdirSync(path.dirname(PENDIENTES_PATH), { recursive: true });
  fs.writeFileSync(PENDIENTES_PATH, JSON.stringify(todos, null, 2), 'utf8');
}

// ── Job principal ─────────────────────────────────────────────────────────────
async function prellenar(fechaManual) {
  const { desde, hasta, fecha } = rangoDia(fechaManual);
  console.log(`[prellenar_contabilidad] Procesando turno del ${fecha}…`);

  // 1. Verificar duplicados
  try {
    const existe = await axios.get(`${CFO_BASE}/api/contabilidad/ingresos`, {
      params: { desde: fecha, hasta: fecha },
      headers: { 'x-api-token': CFO_TOKEN },
      timeout: 10000,
    });
    const yaExisten = (existe.data || []).filter(i =>
      i.tipo === 'ventas' && (i.notas || '').includes('Prellenado automático')
    );
    if (yaExisten.length > 0) {
      console.log(`[prellenar_contabilidad] Ya existen ${yaExisten.length} ingreso(s) para ${fecha} — omitido.`);
      return;
    }
  } catch (e) {
    console.error('[prellenar_contabilidad] CFO Agent no disponible:', e.message);
    return;
  }

  // 2. Descargar recibos + tipos de pago + shifts en paralelo
  let recibos, tiposPago, shifts;
  try {
    [recibos, tiposPago, shifts] = await Promise.all([
      loyverse.ventasFiltradas({ desde, hasta, limit: 250, sin_reembolsos: false }),
      loyverse.obtenerTiposPago(),
      loyverse.obtenerShifts(desde, hasta),
    ]);
  } catch (e) {
    console.error('[prellenar_contabilidad] Error Loyverse:', e.message);
    return;
  }

  // Mapa UUID → nombre legible
  const pagoMap = {};
  tiposPago.forEach(t => { pagoMap[t.id] = t.name; });

  // 3. Ingresos por tipo de pago desde RECIBOS
  const porTipo = {};
  const pendientesDecision = [];   // WhatsApp y similares
  let descuentosTotal = 0;
  let reembolsosTotal = 0;

  (recibos || []).forEach(r => {
    const esReembolso = !!(r.refund_for || r.total_money < 0);
    if (esReembolso) { reembolsosTotal += Math.abs(r.total_money || 0); return; }
    descuentosTotal += r.discount_amount || 0;
    (r.payments || []).forEach(p => {
      const nombreRaw = pagoMap[p.payment_type_id] || p.payment_type_id || 'Otro';
      const monto     = p.money_amount || 0;
      if (requiereDecision(nombreRaw)) {
        // Acumular para pendientes — el dueño decide el tipo
        const existente = pendientesDecision.find(x => x.tipo_pago === nombreRaw);
        if (existente) { existente.monto += monto; }
        else { pendientesDecision.push({ tipo_pago: nombreRaw, monto, ticket: r.receipt_number }); }
      } else {
        const nombre    = normalizarTipo(nombreRaw);
        porTipo[nombre] = (porTipo[nombre] || 0) + monto;
      }
    });
  });

  // 4. Procesar movimientos de caja del shift
  const pendientes = [];
  const ingresosExtra  = [];   // PAY_IN tc/ta
  const gastosAuto     = [];   // PAY_OUT compra/nomina

  (shifts || []).forEach(s => {
    (s.cash_movements || []).forEach(mov => {
      const horaGMT7 = new Date(new Date(mov.created_at).getTime() + TZ_OFFSET_MS)
                         .toISOString().slice(11, 16);
      const resultado = clasificarMovimiento({ ...mov, fecha });
      if (resultado.accion === 'ingreso') {
        ingresosExtra.push({ ...resultado, hora: horaGMT7, raw: mov });
      } else if (resultado.accion === 'gasto') {
        gastosAuto.push({ ...resultado, hora: horaGMT7, raw: mov });
      } else {
        pendientes.push({
          tipo_movimiento: mov.type,
          monto:           mov.money_amount,
          comentario:      mov.comment || '—',
          hora:            horaGMT7,
          razon:           resultado.razon,
        });
      }
    });
  });

  // Notas base para todos los registros
  let notasCierre = '';
  if (shifts && shifts.length > 0) {
    const sh = shifts[0];
    const dif = (sh.actual_cash || 0) - (sh.expected_cash || 0);
    notasCierre = `\nCierre: efectivo esperado $${sh.expected_cash}, real $${sh.actual_cash}` +
                  (dif !== 0 ? `, diferencia $${dif}` : ', sin diferencia') + '.';
  }

  const notasBase = [
    `Prellenado automático desde Loyverse. ${(recibos || []).filter(r => !r.refund_for && r.total_money >= 0).length} recibo(s) del ${fecha}.`,
    descuentosTotal > 0  ? `Descuentos: $${Math.round(descuentosTotal * 100) / 100}`  : null,
    reembolsosTotal > 0  ? `Reembolsos: $${Math.round(reembolsosTotal * 100) / 100}` : null,
    notasCierre || null,
  ].filter(Boolean).join('\n');

  // 5. Crear ingresos por tipo de pago (recibos)
  for (const [tipoPago, monto] of Object.entries(porTipo)) {
    const m = Math.round(monto * 100) / 100;
    if (m <= 0) continue;
    try {
      const r = await crearIngreso({ fecha, concepto: `Ventas ${fecha} – ${tipoPago}`, tipo: 'ventas', monto: m, notas: notasBase });
      console.log(`[prellenar_contabilidad] ✅ ingreso  ${tipoPago}: $${m} → id ${r.id}`);
    } catch (e) {
      console.error(`[prellenar_contabilidad] ❌ ingreso "${tipoPago}":`, e.response?.data || e.message);
    }
  }

  // 6. Crear ingresos extra de movimientos TC/TA
  for (const item of ingresosExtra) {
    const m = Math.round(item.monto * 100) / 100;
    try {
      const r = await crearIngreso({ fecha, concepto: item.concepto, tipo: item.tipo, monto: m, notas: notasBase });
      console.log(`[prellenar_contabilidad] ✅ ingreso  apps (${item.raw.comment}): $${m} → id ${r.id}`);
    } catch (e) {
      console.error(`[prellenar_contabilidad] ❌ ingreso apps:`, e.response?.data || e.message);
    }
  }

  // 7. Crear gastos auto-catalogados
  for (const item of gastosAuto) {
    const m = Math.round(item.monto * 100) / 100;
    try {
      const r = await crearGasto({ fecha, concepto: item.concepto, tipo: item.tipo, monto: m, deducible: 1, notas: notasBase });
      console.log(`[prellenar_contabilidad] ✅ gasto    ${item.tipo} (${item.raw.comment}): $${m} → id ${r.id}`);
    } catch (e) {
      console.error(`[prellenar_contabilidad] ❌ gasto "${item.tipo}":`, e.response?.data || e.message);
    }
  }

  // 8. Guardar pendientes (movimientos de caja sin categoría + WhatsApp sin decidir)
  const todosPendientes = [
    ...pendientes,
    ...pendientesDecision.map(p => ({
      tipo_movimiento: 'INGRESO_PENDIENTE',
      monto:           Math.round(p.monto * 100) / 100,
      comentario:      p.tipo_pago,
      hora:            '—',
      razon:           `Pago "${p.tipo_pago}" $${Math.round(p.monto * 100) / 100} — decide si va a Efectivo, Transferencia u otro tipo`,
    })),
  ];

  if (todosPendientes.length > 0) {
    guardarPendientes(fecha, todosPendientes);
    console.log(`[prellenar_contabilidad] ⚠️  ${todosPendientes.length} pendiente(s) guardados en pendientes_contabilidad.json:`);
    todosPendientes.forEach(p => console.log(`     ${p.tipo_movimiento} $${p.monto} "${p.comentario}" ${p.hora}`));
  } else {
    console.log(`[prellenar_contabilidad] ✅ Sin pendientes de catalogar.`);
  }

  console.log(`[prellenar_contabilidad] ── ${fecha} completo.`);
}

// ── Cron: 2:05 AM GMT-7 = 09:05 UTC, martes–domingo ─────────────────────────
cron.schedule('5 9 * * 2-0', () => {
  console.log('[prellenar_contabilidad] ⏰ Cron activado — 2:05 AM GMT-7');
  prellenar().catch(e => console.error('[prellenar_contabilidad] error fatal:', e.message));
}, { timezone: 'UTC' });

console.log('[prellenar_contabilidad] ✅ Job registrado — corre a las 2:05 AM GMT-7 mar–dom');

// ── Ejecución manual ──────────────────────────────────────────────────────────
if (require.main === module) {
  const idxFecha = process.argv.indexOf('--fecha');
  const fechaArg = idxFecha !== -1 ? process.argv[idxFecha + 1] : null;
  if (process.argv.includes('--now') || fechaArg) {
    console.log('[prellenar_contabilidad] Ejecutando manualmente…');
    prellenar(fechaArg).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  }
}

module.exports = { prellenar };
