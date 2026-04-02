/**
 * tacos-aragon-api – Backend central del ecosistema Tacos Aragón.
 * Conecta: WhatsApp bot, Loyverse POS, Facturama, bot de llamadas y agente IA.
 *
 * Puerto: 3001
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const http       = require('http');
const crypto     = require('crypto');
const { WebSocketServer } = require('ws');
const cfg        = require('./config');
const auth       = require('./middleware/auth');

const app    = express();
const server = http.createServer(app);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

// ─── WebSocket para actualizaciones en tiempo real ───────────────────────────
const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }, done) => {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (!token) { done(false, 401, 'No autorizado'); return; }
    try {
      const bufA = Buffer.from(token);
      const bufB = Buffer.from(cfg.API_TOKEN);
      if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
        done(true);
      } else {
        console.warn(`[ws] Conexión rechazada por token inválido`);
        done(false, 401, 'No autorizado');
      }
    } catch {
      done(false, 401, 'No autorizado');
    }
  },
});
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.send(JSON.stringify({ tipo: 'conectado', mensaje: 'API Tacos Aragón lista' }));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

// Exportar broadcast para uso en rutas
app.locals.broadcast = broadcast;

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Permitir peticiones sin origin (apps móviles, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS: origen no permitido'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Log todas las peticiones entrantes
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | IP: ${req.ip}`);
  next();
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Límite global — separado por token para que servicios internos no bloqueen a la app
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => req.headers['x-api-token'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});

// Límite estricto para endpoints de IA (caro y lento)
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de consultas al agente alcanzado' },
});

// Límite para facturación (operación fiscal crítica)
const facturacionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de operaciones de facturación alcanzado' },
});

app.use(globalLimiter);

// ─── Health check (sin auth) ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    nombre: 'Tacos Aragón API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Rutas autenticadas ───────────────────────────────────────────────────────
app.use('/api', auth);
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/ventas',       require('./routes/ventas'));
app.use('/api/whatsapp',     require('./routes/whatsapp'));
app.use('/api/facturar',     facturacionLimiter, require('./routes/facturacion'));
app.use('/api/agente/chat',  aiLimiter);
app.use('/api/agente/voz',   aiLimiter);
app.use('/api/agente',       require('./routes/agente'));
app.use('/api/impuestos',    require('./routes/cfo'));
app.use('/api/inventario',   require('./routes/cfo'));
app.use('/api/config',       require('./routes/cfo'));
app.use('/api/contabilidad', require('./routes/contabilidad'));

// ─── Rutas internas (orquestador) ────────────────────────────────────────────
app.use('/interno', require('./routes/interno'));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  // No exponer detalles de error en producción
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Jobs programados ─────────────────────────────────────────────────────────
require('./jobs/prellenar_contabilidad');
require('./jobs/archivar_tickets');

// ─── Inicio ──────────────────────────────────────────────────────────────────
server.listen(cfg.PORT, () => {
  console.log(`✅ Tacos Aragón API corriendo en puerto ${cfg.PORT}`);
  console.log(`   Health: http://localhost:${cfg.PORT}/health`);
});
