/**
 * jobs/archivar_tickets.js – Descarga tickets del día desde Loyverse y los guarda en SQLite.
 * Cron: 23:59 GMT-7 (06:59 UTC del día siguiente), todos los días.
 *
 * Uso manual:
 *   node jobs/archivar_tickets.js --now              # Archiva hoy
 *   node jobs/archivar_tickets.js --fecha 2026-03-15  # Archiva fecha específica
 *   node jobs/archivar_tickets.js --mes 2026-03       # Archiva mes completo
 */

const cron   = require('node-cron');
const path   = require('path');
const Database = require('better-sqlite3');

const { obtenerRecibos } = require('../services/loyverse');

// ─── Base de datos ───────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '..', 'datos', 'tickets.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    receipt_id     TEXT PRIMARY KEY,
    receipt_number TEXT NOT NULL,
    receipt_date   TEXT NOT NULL,
    fecha_local    TEXT NOT NULL,
    total          REAL NOT NULL DEFAULT 0,
    canal          TEXT,
    nota           TEXT,
    empleado_id    TEXT,
    es_reembolso   INTEGER NOT NULL DEFAULT 0,
    datos_json     TEXT NOT NULL,
    archivado_en   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_fecha ON tickets(fecha_local);
  CREATE INDEX IF NOT EXISTS idx_tickets_numero ON tickets(receipt_number);
`);

const insertar = db.prepare(`
  INSERT OR IGNORE INTO tickets
    (receipt_id, receipt_number, receipt_date, fecha_local, total, canal, nota, empleado_id, es_reembolso, datos_json)
  VALUES
    (@receipt_id, @receipt_number, @receipt_date, @fecha_local, @total, @canal, @nota, @empleado_id, @es_reembolso, @datos_json)
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const TZ_OFFSET_MS = -7 * 60 * 60 * 1000;

function ahoraLocal() {
  return new Date(Date.now() + TZ_OFFSET_MS);
}

/** Rango UTC para un día local YYYY-MM-DD en GMT-7 */
function rangoDia(fechaLocal) {
  const [y, m, d] = fechaLocal.split('-').map(Number);
  const inicio = new Date(Date.UTC(y, m - 1, d, 7, 0, 0));   // 00:00 GMT-7 = 07:00 UTC
  const fin    = new Date(Date.UTC(y, m - 1, d + 1, 7, 0, 0));
  return { desde: inicio.toISOString(), hasta: fin.toISOString() };
}

function resolverCanal(r) {
  if (r.dining_option) return r.dining_option.toLowerCase();
  const nota = (r.note || '').toUpperCase();
  if (nota.startsWith('DOMICILIO')) return 'domicilio';
  if (nota.startsWith('RECOGER'))   return 'recoger';
  return 'presencial';
}

// ─── Función principal ───────────────────────────────────────────────────────
async function archivar(fechaLocal) {
  const { desde, hasta } = rangoDia(fechaLocal);
  console.log(`[archivar_tickets] Descargando tickets de ${fechaLocal} (${desde} → ${hasta})`);

  const recibos = await obtenerRecibos(desde, hasta);
  if (!recibos.length) {
    console.log(`[archivar_tickets] Sin tickets para ${fechaLocal}`);
    return { fecha: fechaLocal, nuevos: 0, total: 0 };
  }

  const insertMany = db.transaction((lista) => {
    let nuevos = 0;
    for (const r of lista) {
      const res = insertar.run({
        receipt_id:     r.receipt_id || r.id,
        receipt_number: r.receipt_number || '',
        receipt_date:   r.receipt_date || r.created_at,
        fecha_local:    fechaLocal,
        total:          r.total_money || 0,
        canal:          resolverCanal(r),
        nota:           r.note || null,
        empleado_id:    r.employee_id || null,
        es_reembolso:   (r.refund_for || r.total_money < 0) ? 1 : 0,
        datos_json:     JSON.stringify(r),
      });
      if (res.changes > 0) nuevos++;
    }
    return nuevos;
  });

  const nuevos = insertMany(recibos);
  console.log(`[archivar_tickets] ✅ ${fechaLocal}: ${nuevos} nuevos de ${recibos.length} tickets`);
  return { fecha: fechaLocal, nuevos, total: recibos.length };
}

/** Archiva todos los días de un mes YYYY-MM */
async function archivarMes(mesStr) {
  const [y, m] = mesStr.split('-').map(Number);
  const diasEnMes = new Date(y, m, 0).getDate();
  const hoyLocal = ahoraLocal().toISOString().slice(0, 10);
  let totalNuevos = 0;

  for (let d = 1; d <= diasEnMes; d++) {
    const fecha = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (fecha > hoyLocal) break; // no archivar futuro
    const { nuevos } = await archivar(fecha);
    totalNuevos += nuevos;
  }
  console.log(`[archivar_tickets] ✅ Mes ${mesStr} completo: ${totalNuevos} tickets nuevos`);
  return totalNuevos;
}

// ─── Cron: 23:59 GMT-7 todos los días ────────────────────────────────────────
cron.schedule('59 6 * * *', async () => {   // 06:59 UTC = 23:59 GMT-7
  try {
    const hoy = ahoraLocal().toISOString().slice(0, 10);
    await archivar(hoy);
  } catch (err) {
    console.error('[archivar_tickets] ❌ Error en cron:', err.message);
  }
}, { timezone: 'UTC' });

console.log('[archivar_tickets] ✅ Job registrado — corre a las 23:59 GMT-7 diario');

// ─── Ejecución manual ────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const idxFecha = args.indexOf('--fecha');
  const idxMes   = args.indexOf('--mes');

  let tarea;
  if (idxMes !== -1 && args[idxMes + 1]) {
    tarea = archivarMes(args[idxMes + 1]);
  } else {
    const fecha = (idxFecha !== -1 && args[idxFecha + 1])
      ? args[idxFecha + 1]
      : ahoraLocal().toISOString().slice(0, 10);
    tarea = archivar(fecha);
  }

  tarea
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { archivar, archivarMes };
