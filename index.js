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
const { WebSocketServer } = require('ws');
const cfg        = require('./config');
const auth       = require('./middleware/auth');

const app    = express();
const server = http.createServer(app);

// ─── WebSocket para actualizaciones en tiempo real ───────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (token !== cfg.API_TOKEN) { ws.close(4001, 'No autorizado'); return; }

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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: '*',                   // La app móvil puede venir de cualquier IP
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Log todas las peticiones entrantes
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | IP: ${req.ip}`);
  next();
});

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

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
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/ventas',      require('./routes/ventas'));
app.use('/api/whatsapp',    require('./routes/whatsapp'));
app.use('/api/facturar',    require('./routes/facturacion'));
app.use('/api/agente',      require('./routes/agente'));
app.use('/api/contabilidad', require('./routes/contabilidad'));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Jobs programados ─────────────────────────────────────────────────────────
require('./jobs/prellenar_contabilidad');

// ─── Inicio ──────────────────────────────────────────────────────────────────
server.listen(cfg.PORT, () => {
  console.log(`✅ Tacos Aragón API corriendo en puerto ${cfg.PORT}`);
  console.log(`   Health: http://localhost:${cfg.PORT}/health`);
});
