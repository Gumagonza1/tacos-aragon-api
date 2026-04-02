# Tacos Aragón API

Backend REST central del ecosistema Tacos Aragón. Conecta la app móvil, el bot de WhatsApp, el agente IA con tool use, facturación electrónica (CFDI 4.0), contabilidad (CFO Agent) y entregas a domicilio.

---

## Tabla de contenidos

1. [Arquitectura](#1-arquitectura)
2. [Stack](#2-stack)
3. [Endpoints](#3-endpoints)
4. [Agente IA](#4-agente-ia)
5. [Ventas y dashboard](#5-ventas-y-dashboard)
6. [WhatsApp](#6-whatsapp)
7. [Facturación electrónica](#7-facturación-electrónica)
8. [Contabilidad](#8-contabilidad)
9. [CFO Agent proxy](#9-cfo-agent-proxy)
10. [Entregas](#10-entregas)
11. [Recursos del sistema](#11-recursos-del-sistema)
12. [Jobs automáticos](#12-jobs-automáticos)
13. [WebSocket](#13-websocket)
14. [Seguridad](#14-seguridad)
15. [Variables de entorno](#15-variables-de-entorno)
16. [Estructura del proyecto](#16-estructura-del-proyecto)
17. [Instalación](#17-instalación)

---

## 1. Arquitectura

```
  App móvil          Bot WhatsApp          CFO Agent (:3002)
      │                   │                      │
      ▼                   ▼                      ▼
  ┌──────────────────────────────────────────────────┐
  │              tacos-aragon-api (:3001)             │
  │                                                  │
  │  Express + WebSocket + Rate Limiting + Helmet    │
  │                                                  │
  │  routes/          services/         jobs/        │
  │  ├─ dashboard     ├─ loyverse       ├─ prellenar │
  │  ├─ ventas        ├─ facturama      └─ archivar  │
  │  ├─ whatsapp      ├─ whatsapp                    │
  │  ├─ agente        ├─ agente                      │
  │  ├─ facturacion   └─ claude-runner               │
  │  ├─ contabilidad                                 │
  │  ├─ cfo                                          │
  │  └─ interno                                      │
  └─────────┬──────────────┬──────────────┬──────────┘
            │              │              │
        Loyverse       Facturama      Entregas
        POS API        PAC CFDI       (:3005)
```

**Comunicación:**
- App móvil / Bot → API via HTTP + token
- API → CFO Agent via proxy (`:3002`)
- API → Entregas via HTTP directo (`:3005`)
- API → Bot WhatsApp via archivos compartidos (`datos/`)
- Clientes en tiempo real via WebSocket

---

## 2. Stack

| Componente | Tecnología |
|---|---|
| HTTP server | Express 4.18 |
| IA (agente) | Claude Sonnet via `claude -p` CLI |
| Voz → texto | Google Gemini (transcripción) |
| POS | Loyverse REST API |
| Facturación | Facturama PAC (CFDI 4.0) |
| Base de datos | SQLite (better-sqlite3) para tickets |
| Real-time | WebSocket (ws) |
| Jobs | node-cron |
| Seguridad | Helmet, rate-limit, timing-safe auth |
| Runtime | Node.js 18+ / PM2 |
| Timezone | GMT-7 (America/Hermosillo) |

---

## 3. Endpoints

### Sin autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servidor |

### Con autenticación (`x-api-token` header)

#### Agente IA

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/agente/chat` | Chat de texto (sessionId, mensaje) |
| POST | `/api/agente/voz` | Audio → transcripción → respuesta |
| GET | `/api/agente/resumen?periodo=` | Resumen ejecutivo (hoy/semana/mes) |
| GET | `/api/agente/monitor/estado` | Estado del monitor del bot |
| GET | `/api/agente/monitor/alertas` | Alertas pendientes |
| POST | `/api/agente/monitor/comando` | Enviar comando al monitor |
| POST | `/api/agente/encolar` | Encolar mensaje para WhatsApp |
| GET | `/api/agente/pendientes` | Obtener y limpiar respuestas del monitor |

#### Ventas y Dashboard

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard` | Resumen diario + semanal + mensual con gráficas |
| GET | `/api/ventas` | Lista de ventas con filtros (periodo, pago, empleado) |
| GET | `/api/ventas/resumen` | Resumen limpio (total, por pago, por canal, top productos) |
| GET | `/api/ventas/grafica?agrupar=` | Datos para gráficas (dia/hora/semana/mes) |
| GET | `/api/ventas/empleados-ventas` | Ranking de ventas por empleado |
| GET | `/api/ventas/empleados` | Lista de empleados |
| GET | `/api/ventas/tipos-pago` | Catálogo de tipos de pago |
| GET | `/api/ventas/por-producto?nombre=` | Buscar ventas por nombre de producto |
| GET | `/api/ventas/cierres` | Cortes de caja con movimientos |
| GET | `/api/ventas/ticket/:numero` | Detalle de un ticket individual |

#### WhatsApp

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/whatsapp/conversaciones` | Todas las conversaciones |
| GET | `/api/whatsapp/conversaciones/:phone` | Historial de un cliente |
| POST | `/api/whatsapp/conversaciones/:phone/pausar` | Pausar/reanudar bot para cliente |
| GET | `/api/whatsapp/stats` | Estadísticas (total, pausados, activos) |

#### Facturación

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/facturar/ticket/:numero` | Datos del ticket para prellenar factura |
| GET | `/api/facturar/cliente/:rfc` | Buscar cliente por RFC en Facturama |
| POST | `/api/facturar` | Timbrar factura CFDI 4.0 |
| GET | `/api/facturar/lista` | Listar facturas emitidas (fechaInicio, fechaFin) |
| GET | `/api/facturar/descargar/:cfdiId` | Descargar factura (formato=pdf/xml) |

#### Contabilidad

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/contabilidad/pendientes` | Movimientos sin catalogar |
| POST | `/api/contabilidad/pendientes/resolver` | Catalogar como ingreso/gasto/ignorar |
| DELETE | `/api/contabilidad/pendientes/:idx` | Ignorar movimiento |
| * | `/api/contabilidad/*` | Proxy al CFO Agent (`:3002`) |

#### CFO Agent

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/config/subir-xml` | Subir XMLs fiscales (multipart, max 10MB) |
| * | `/*` | Proxy genérico al CFO Agent |

#### Interno (orquestación entre servicios)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/interno/mensaje-admin` | Encolar mensaje para admin via WhatsApp |
| POST | `/interno/entrega-wa` | Acciones del servicio de entregas → WhatsApp |
| POST | `/interno/crear-entrega` | Registrar entrega desde el bot |
| GET | `/interno/recursos` | Monitoreo de recursos (CPU, RAM, disco, Docker) |

---

## 4. Agente IA

El agente usa **Claude Sonnet** via `claude -p` (CLI local, no SDK) para mantener sesiones persistentes.

### Ejecución

`services/claude-runner.js` maneja:
- **Sesiones** — Map en memoria, TTL 1 hora, max 20 mensajes por sesión
- **Ejecución** — Escribe prompt a `/tmp/`, ejecuta `claude -p --output-format stream-json --model sonnet --max-turns 10 --max-budget-usd 0.50`
- **Streaming** — Parsea eventos JSON (assistant, tool_use, result)
- **Timeouts** — 90s de inactividad, 2 min total
- **Limpieza** — Mata procesos hijos al terminar

### Herramientas del agente

| Tool | Función |
|------|---------|
| `obtener_ventas` | Ventas por periodo (hoy, ayer, semana, mes, rango) |
| `obtener_ticket` | Detalle de un ticket por número |
| `obtener_whatsapp` | Conversaciones activas del bot |
| `buscar_cliente_rfc` | Buscar cliente en Facturama por RFC |
| `crear_factura` | Timbrar CFDI 4.0 |

### Voz

`POST /api/agente/voz` recibe audio (webm, ogg, mp4, wav, max 5MB), lo transcribe con **Google Gemini** y pasa el texto al agente Claude.

---

## 5. Ventas y dashboard

Datos de ventas desde **Loyverse POS API** (`services/loyverse.js`):

- Paginación automática (cursor-based, 250 items/página)
- Fechas siempre en GMT-7
- Semana fiscal: martes a domingo
- Resolución de canales: dining_option o nota del bot (DOMICILIO/RECOGER)
- Tracking de reembolsos
- Agrupación para gráficas: por día, hora, semana o mes

---

## 6. WhatsApp

Lee archivos compartidos del bot (`datos/`):
- `memoria_chat.json` — Conversaciones activas
- `pausas.json` — Estado de pausa por número

No envía mensajes directamente. Para enviar, usa `/interno/mensaje-admin` o `/api/agente/encolar`.

---

## 7. Facturación electrónica

Integración con **Facturama** para CFDI 4.0:

- Modo sandbox/producción configurable
- Régimen fiscal: Plataformas Tecnológicas (Art. 113-A LISR)
- Código SAT: 90101501 (alimentos preparados), unidad H87 (pieza)
- IVA 16% incluido (split automático subtotal + impuesto)
- Rate limit: 20 req/15 min

---

## 8. Contabilidad

Gestión de movimientos pendientes de catalogar:

| Tipo | Subtipos |
|------|----------|
| `ingreso` | ventas, otros |
| `gasto` | nomina, insumos, servicios, materia_prima, otros |
| `ignorar` | Descarta el movimiento |

Movimientos no catalogados se guardan en `datos/pendientes_contabilidad.json`. Rutas que no son `/pendientes` se proxean al CFO Agent.

---

## 9. CFO Agent proxy

Proxy transparente al CFO Agent (`:3002`):
- Timeout: 5 minutos (operaciones fiscales son lentas)
- Preserva content-type y headers
- Endpoint especial para subir XMLs fiscales (multipart)
- Retorna errores del CFO tal cual

---

## 10. Entregas

Comunicación con el servicio de entregas (`:3005`):

- `POST /interno/crear-entrega` — Registra entrega con GPS, ticket, cliente
- `POST /interno/entrega-wa` — Acciones del repartidor → bot WhatsApp (mensaje, pausar, reanudar)
- HTTP directo (no axios) para baja latencia

---

## 11. Recursos del sistema

`GET /interno/recursos` devuelve:

```json
{
  "ram": { "used_mb": 1024, "total_mb": 4096, "free_mb": 3072, "pct": 25 },
  "cpu": { "load_1m": 0.5, "load_5m": 0.3, "load_15m": 0.2 },
  "disco": { "total": "50G", "usado": "15G", "disponible": "35G", "pct": "30%" },
  "uptime_horas": 720,
  "containers": [],
  "sar": []
}
```

Timeout de 5s por comando shell. Caché y sanitización de info del sistema.

---

## 12. Jobs automáticos

### Prellenar contabilidad

- **Cuándo:** 2:05 AM GMT-7, martes a domingo
- **Qué hace:** Obtiene ventas y movimientos de caja del día anterior, los clasifica automáticamente y los envía al CFO Agent
- **Clasificación:**
  - Receipts por tipo de pago → ingreso
  - PAY_IN con "tc"/"ta" → ingreso ventas
  - PAY_OUT con "compra" → gasto materia prima
  - PAY_OUT con "nómina" → gasto nómina
  - Sin clasificar → pendientes_contabilidad.json
- **Manual:** `node jobs/prellenar_contabilidad.js --now` o `--fecha 2026-03-15`

### Archivar tickets

- **Cuándo:** 23:59 GMT-7, todos los días
- **Qué hace:** Descarga tickets del día de Loyverse y los guarda en SQLite (`datos/tickets.db`)
- **Schema:** receipt_id, receipt_number, fecha_local, total, canal, nota, empleado_id, es_reembolso, datos_json
- **WAL mode** para acceso concurrente
- **Manual:** `node jobs/archivar_tickets.js --now` o `--mes 2026-03`

---

## 13. WebSocket

Conexión en tiempo real para la app móvil:

```javascript
const ws = new WebSocket('ws://host:3001?token=API_TOKEN');
```

- Autenticación via query param (timing-safe)
- Broadcast de eventos a todos los clientes conectados
- Usado para notificaciones en tiempo real de ventas y alertas

---

## 14. Seguridad

| Capa | Implementación |
|------|---------------|
| Autenticación | Token en header `x-api-token` (timing-safe comparison) |
| Rate limiting global | 300 req / 15 min por IP |
| Rate limiting IA | 30 req / 15 min |
| Rate limiting facturación | 20 req / 15 min |
| Headers | Helmet (security headers) |
| CORS | Allowlist dinámica (ALLOWED_ORIGINS) |
| Body | JSON max 1MB |
| Input | Validación regex (RFC, teléfono, ticket, CFDI ID) |
| Errores | Sin detalles internos en respuestas 500 |
| Red | Solo accesible via Tailscale |

---

## 15. Variables de entorno

### Requeridas

| Variable | Descripción |
|----------|-------------|
| `API_TOKEN` | Token de autenticación (generar con `crypto.randomBytes(32)`) |
| `LOYVERSE_TOKEN` | Token OAuth de Loyverse POS |
| `LOYVERSE_STORE_ID` | ID de la tienda en Loyverse |

### Opcionales

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto del servidor |
| `NODE_ENV` | — | Entorno (production/development) |
| `ALLOWED_ORIGINS` | `localhost:3000` | Orígenes CORS (comma-separated) |
| `GEMINI_KEY` | — | API key de Google Gemini (transcripción de voz) |
| `CFO_BASE` | `http://localhost:3002` | URL del CFO Agent |
| `CFO_TOKEN` | — | Token del CFO Agent |
| `FACTURAMA_USER` | — | Usuario de Facturama |
| `FACTURAMA_PASSWORD` | — | Contraseña de Facturama |
| `FACTURAMA_SANDBOX` | `true` | Modo sandbox (true) o producción (false) |
| `EMISOR_RFC` | — | RFC del emisor para facturas |
| `EMISOR_NOMBRE` | — | Nombre del emisor |
| `DATOS_PATH` | — | Ruta a datos compartidos del bot |
| `ENTREGAS_URL` | `http://...:3005` | URL del servicio de entregas |
| `ENTREGAS_TOKEN` | `{API_TOKEN}` | Token del servicio de entregas |

---

## 16. Estructura del proyecto

```
tacos-aragon-api/
├── index.js                    # Express + WebSocket + routes + jobs
├── config.js                   # Env vars, credenciales, paths
├── middleware/
│   └── auth.js                 # Token auth (timing-safe)
├── routes/
│   ├── dashboard.js            # Resumen con gráficas
│   ├── ventas.js               # Ventas, filtros, gráficas, cierres
│   ├── whatsapp.js             # Conversaciones del bot
│   ├── agente.js               # Chat IA, voz, monitor
│   ├── facturacion.js          # CFDI 4.0 (Facturama)
│   ├── contabilidad.js         # Pendientes + proxy CFO
│   ├── cfo.js                  # Proxy genérico CFO Agent
│   └── interno.js              # Orquestación entre servicios
├── services/
│   ├── loyverse.js             # Wrapper Loyverse POS API
│   ├── facturama.js            # Wrapper Facturama PAC
│   ├── whatsapp.js             # Lectura de datos del bot
│   ├── agente.js               # System prompt + tools del agente
│   └── claude-runner.js        # Ejecutor claude -p con sesiones
├── jobs/
│   ├── prellenar_contabilidad.js  # Catalogación automática (2:05 AM)
│   └── archivar_tickets.js        # Archivado SQLite (23:59)
├── datos/                      # (no versionado)
│   ├── pendientes_contabilidad.json
│   └── tickets.db
├── certs/                      # (no versionado)
├── .env.example
├── ecosystem.config.example.js
├── package.json
└── .gitignore
```

---

## 17. Instalación

```bash
# Clonar
git clone https://github.com/Gumagonza1/tacos-aragon-api.git
cd tacos-aragon-api

# Dependencias
npm install

# Configurar
cp .env.example .env
cp ecosystem.config.example.js ecosystem.config.js
# Editar ambos archivos con tus credenciales

# Iniciar
pm2 start ecosystem.config.js

# Logs
pm2 logs TacosAPI
```

### Docker

La API corre como servicio en el `docker-compose.yml` del ecosistema:

```yaml
api:
  build: ./tacos-aragon-api
  container_name: tacos-api
  ports:
    - "127.0.0.1:3001:3001"
  environment:
    - API_TOKEN=${API_TOKEN}
    - LOYVERSE_TOKEN=${LOYVERSE_TOKEN}
    - LOYVERSE_STORE_ID=${LOYVERSE_STORE_ID}
  restart: unless-stopped
```

---

## Ecosistema

| Servicio | Repo | Puerto |
|----------|------|--------|
| Bot WhatsApp | [whatsapp-tacos-bot](https://github.com/Gumagonza1/whatsapp-tacos-bot) | 3003 |
| API central | este repo | 3001 |
| Monitor | [tacos-aragon-monitor](https://github.com/Gumagonza1/tacos-aragon-monitor) | — |
| CFO Agent | cfo_aragon_agent | 3002 |
| Entregas | tacos-aragon-entregas | 3005 |
