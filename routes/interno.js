'use strict';

const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const cfg    = require('../config');

const QUEUE_PATH = cfg.DATOS_PATH
  ? path.join(cfg.DATOS_PATH, 'agente_queue.json')
  : null;

function authInterno(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const bufA = Buffer.from(token);
    const bufB = Buffer.from(cfg.API_TOKEN);
    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      return next();
    }
  } catch {
    // fallo silencioso — retorna 401 abajo
  }

  console.warn(`[interno] Acceso denegado | IP: ${req.ip}`);
  return res.status(401).json({ error: 'No autorizado' });
}

// POST /interno/mensaje-admin
// Encola un mensaje para enviarlo al admin via el bot de WhatsApp.
// El bot lee agente_queue.json cada 10 segundos y envia los pendientes.
router.post('/mensaje-admin', authInterno, (req, res) => {
  const { mensaje } = req.body;

  if (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length === 0) {
    return res.status(400).json({ error: 'Campo "mensaje" requerido' });
  }

  if (mensaje.length > 4000) {
    return res.status(400).json({ error: 'Mensaje demasiado largo (max 4000 caracteres)' });
  }

  if (!QUEUE_PATH) {
    console.error('[interno] DATOS_PATH no configurado — no se puede encolar mensaje');
    return res.status(503).json({ error: 'Cola de mensajes no disponible — DATOS_PATH no configurado' });
  }

  try {
    let cola = [];
    if (fs.existsSync(QUEUE_PATH)) {
      try {
        cola = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8') || '[]');
        if (!Array.isArray(cola)) cola = [];
      } catch {
        cola = [];
      }
    }

    const item = {
      id:        `orch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mensaje:   mensaje.trim(),
      timestamp: Date.now(),
      enviado:   false,
      origen:    'orquestador',
    };

    cola.push(item);
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(cola, null, 2), 'utf8');

    console.log(`[interno] Mensaje encolado: ${item.id}`);
    res.json({ ok: true, id: item.id });
  } catch (err) {
    console.error('[interno] Error al escribir cola:', err.message);
    res.status(500).json({ error: 'Error interno al encolar mensaje' });
  }
});

// POST /interno/entrega-wa
// El microservicio de entregas (Docker/Linux) llama aqui para:
// - Enviar mensaje WhatsApp al cliente (accion: 'mensaje')
// - Pausar el bot para ese cliente (accion: 'pausar')
// - Reanudar el bot para ese cliente (accion: 'reanudar')
router.post('/entrega-wa', authInterno, (req, res) => {
  const { telefono, mensaje, accion } = req.body;

  if (!telefono || typeof telefono !== 'string' || !/^\d{10,15}$/.test(telefono)) {
    return res.status(400).json({ error: 'Campo "telefono" invalido (10-15 digitos)' });
  }

  const accionesValidas = ['mensaje', 'pausar', 'reanudar'];
  const acc = accion || 'mensaje';
  if (!accionesValidas.includes(acc)) {
    return res.status(400).json({ error: `Accion invalida: ${acc}` });
  }

  if (acc === 'mensaje' && (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length === 0)) {
    return res.status(400).json({ error: 'Campo "mensaje" requerido para accion "mensaje"' });
  }

  if (mensaje && mensaje.length > 4000) {
    return res.status(400).json({ error: 'Mensaje demasiado largo (max 4000 caracteres)' });
  }

  try {
    // Lazy-require para no romper si el modulo no existe todavia
    let mensajesDb;
    try {
      mensajesDb = require(path.join(cfg.DATOS_PATH, 'mensajes_db'));
    } catch {
      return res.status(503).json({ error: 'mensajes_db no disponible — DATOS_PATH no configurado' });
    }

    const id = `ent-wa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    mensajesDb.encolarEntregaWa(id, telefono, mensaje || null, acc);

    console.log(`[interno] Entrega WA encolada: ${id} | ${acc} | ${telefono}`);
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[interno] Error encolando entrega-wa:', err.message);
    res.status(500).json({ error: 'Error interno al encolar mensaje' });
  }
});

// POST /interno/crear-entrega
// El bot llama aqui cuando confirma una orden a domicilio.
// Proxy hacia la app de entregas para registrar al cliente automaticamente.
router.post('/crear-entrega', authInterno, async (req, res) => {
  const { telefono, gpsCoords, receiptNumber, nombre } = req.body;

  if (!telefono || typeof telefono !== 'string' || !/^\d{10,15}$/.test(telefono)) {
    return res.status(400).json({ error: 'Campo "telefono" invalido (10-15 digitos)' });
  }

  try {
    const payload = JSON.stringify({
      telefonos:     [telefono],
      nombres:       nombre ? [nombre] : [],
      gpsCoords:     Array.isArray(gpsCoords) ? gpsCoords : [],
      noPausar:      true,
      receiptNumber: receiptNumber || null,
    });

    const url = new URL('/api/entregas/grupo', cfg.ENTREGAS_URL);

    const resp = await new Promise((resolve, reject) => {
      const mod = url.protocol === 'https:' ? require('https') : require('http');
      const r = mod.request(url, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'x-api-token':   cfg.ENTREGAS_TOKEN,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10_000,
      }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, data: JSON.parse(body) }); }
          catch { resolve({ status: resp.statusCode, data: body }); }
        });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Timeout entregas')); });
      r.write(payload);
      r.end();
    });

    if (resp.status >= 400) {
      console.error(`[interno] Entregas respondio ${resp.status}:`, resp.data);
      return res.status(resp.status).json(resp.data);
    }

    console.log(`[interno] Entrega creada para ${telefono} (ticket ${receiptNumber || 'N/A'})`);
    res.status(201).json(resp.data);
  } catch (err) {
    console.error('[interno] Error creando entrega:', err.message);
    res.status(502).json({ error: 'No se pudo conectar con el servicio de entregas' });
  }
});

// GET /interno/recursos
// Devuelve uso actual de CPU, RAM, disco y contenedores Docker.
router.get('/recursos', authInterno, async (req, res) => {
  const { execSync } = require('child_process');

  try {
    const run = (cmd) => execSync(cmd, { timeout: 5000 }).toString().trim();

    // RAM
    const memInfo = run("free -b | grep Mem");
    const [, memTotal, memUsed] = memInfo.split(/\s+/).map(Number);

    // CPU (load average)
    const loadAvg = run("cat /proc/loadavg").split(/\s+/);

    // Disco
    const discoLine = run("df -B1 / | tail -1");
    const [, discoTotal, discoUsed, discoFree, discoPct] = discoLine.split(/\s+/);

    // Uptime
    const uptime = run("uptime -p");

    // Docker
    let contenedores = [];
    try {
      const raw = run("docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}'");
      contenedores = raw.split('\n').map(l => {
        const [nombre, cpu, mem] = l.split('|');
        return { nombre, cpu, mem };
      });
    } catch { /* docker no disponible */ }

    // SAR (últimas horas si hay datos)
    let historial = null;
    try {
      const sarCpu = run("sar -u 1 0 2>/dev/null || echo ''");
      const sarMem = run("sar -r 1 0 2>/dev/null || echo ''");
      if (sarCpu) historial = { cpu: sarCpu, mem: sarMem };
    } catch { /* sar sin datos aún */ }

    const gb = (b) => (Number(b) / 1073741824).toFixed(1) + ' GB';

    res.json({
      ram: {
        total:     gb(memTotal),
        usado:     gb(memUsed),
        libre:     gb(memTotal - memUsed),
        porcentaje: ((memUsed / memTotal) * 100).toFixed(1) + '%',
      },
      cpu: {
        load_1m:  loadAvg[0],
        load_5m:  loadAvg[1],
        load_15m: loadAvg[2],
      },
      disco: {
        total:     gb(discoTotal),
        usado:     gb(discoUsed),
        libre:     gb(discoFree),
        porcentaje: discoPct,
      },
      uptime,
      contenedores,
      historial,
    });
  } catch (err) {
    console.error('[interno] Error obteniendo recursos:', err.message);
    res.status(500).json({ error: 'Error obteniendo recursos del sistema' });
  }
});

module.exports = router;
