# tacos-aragon-api

Central REST API + intelligent agent for the **Tacos Aragón** mobile app. Exposes Loyverse sales data, WhatsApp conversation history, and CFDI 4.0 invoicing — orchestrated by an agent with tool use.

## Stack

- **Node.js + Express** — REST server
- **Claude (Anthropic)** — agent with tool use (queries, reasoning, invoicing)
- **Loyverse POS** — sales and ticket data source
- **Facturama PAC** — CFDI 4.0 electronic invoice stamping
- **Gemini** — voice transcription (STT)
- **PM2** — production process manager

## Agent Architecture

```
Mobile app → POST /api/agente/chat
              │
              └─► services/agente.js (Claude)
                    │
                    ├── obtener_ventas    → Loyverse /receipts
                    ├── obtener_ticket   → Loyverse /receipts/:id
                    ├── obtener_whatsapp → WhatsApp bot memory
                    ├── buscar_cliente_rfc → Facturama /clients
                    └── crear_factura   → Facturama CFDI 4.0
```

The agent runs an **agentic loop**: it calls tools autonomously until it has a complete answer.

## Main Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/health` | Health check (no auth required) |
| `POST` | `/api/agente/chat` | Text chat with the agent |
| `POST` | `/api/agente/voz` | Audio transcription + agent response |
| `GET`  | `/api/agente/resumen` | Executive summary for a period |
| `GET`  | `/api/ventas` | Sales with filters (date, payment type, employee) |
| `GET`  | `/api/whatsapp/stats` | WhatsApp conversation statistics |

All `/api/*` endpoints require the header `x-api-token: <API_TOKEN>`.

## Installation

```bash
git clone <repo>
cd tacos-aragon-api
npm install

cp ecosystem.config.example.js ecosystem.config.js
# Edit ecosystem.config.js with your real keys

pm2 start ecosystem.config.js
pm2 logs tacos-api
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `API_TOKEN` | Auth token for the mobile app | **Yes** |
| `ANTHROPIC_KEY` | Claude API key | **Yes** |
| `LOYVERSE_TOKEN` | Loyverse POS OAuth token | **Yes** |
| `LOYVERSE_STORE_ID` | Loyverse store ID | **Yes** |
| `GEMINI_KEY` | Google Gemini key (voice STT) | **Yes** |
| `FACTURAMA_USER` | Facturama PAC username | For invoicing |
| `FACTURAMA_PASSWORD` | Facturama password | For invoicing |
| `FACTURAMA_SANDBOX` | `true` for testing, `false` for production | No |
| `EMISOR_RFC` | Invoice issuer RFC | For invoicing |
| `DATOS_PATH` | Absolute path to shared bot-tacos/datos folder | Optional |
| `TAX_BOT_PATH` | Absolute path to tax_aragon_bot | Optional |
| `FISCAL_PATH` | Absolute path to tacos-aragon-fiscal | Optional |
| `PORT` | Server port (default: 3001) | No |

> **Security:** The server runs exclusively on the Tailscale network (100.64.0.0/10).
> `API_TOKEN` has no default — the server will refuse to start without it.

## Security Notes

- Never commit `ecosystem.config.js`, `certs/`, or any `.pem`/`.key` file
- Rotate `API_TOKEN` if compromised
- Rotate `ANTHROPIC_KEY` from [console.anthropic.com](https://console.anthropic.com/settings/keys) if exposed

---

# tacos-aragon-api (Español)

API REST central + agente inteligente para la app móvil de **Tacos Aragón**. Expone ventas de Loyverse, historial de WhatsApp y facturación CFDI 4.0, orquestados por un agente con _tool use_.

## Stack

- **Node.js + Express** — servidor REST
- **Claude (Anthropic)** — agente con tool use (consulta, razona y factura)
- **Loyverse POS** — fuente de ventas y tickets
- **Facturama PAC** — timbrado CFDI 4.0
- **Gemini** — transcripción de voz (STT)
- **PM2** — gestor de procesos en producción

## Arquitectura del agente

```
App móvil → POST /api/agente/chat
              │
              └─► services/agente.js (Claude)
                    │
                    ├── obtener_ventas   → Loyverse /receipts
                    ├── obtener_ticket   → Loyverse /receipts/:id
                    ├── obtener_whatsapp → memoria del bot WhatsApp
                    ├── buscar_cliente_rfc → Facturama /clients
                    └── crear_factura   → Facturama CFDI 4.0
```

El agente ejecuta un **loop agéntico**: llama herramientas de forma autónoma hasta tener la respuesta completa.

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/health` | Health check (sin autenticación) |
| `POST` | `/api/agente/chat` | Chat de texto con el agente |
| `POST` | `/api/agente/voz` | Transcripción de audio + respuesta del agente |
| `GET`  | `/api/agente/resumen` | Resumen ejecutivo por período |
| `GET`  | `/api/ventas` | Ventas con filtros (fecha, tipo de pago, empleado) |
| `GET`  | `/api/whatsapp/stats` | Estadísticas de conversaciones WhatsApp |

Todos los endpoints `/api/*` requieren el header `x-api-token: <API_TOKEN>`.

## Instalación

```bash
git clone <repo>
cd tacos-aragon-api
npm install

cp ecosystem.config.example.js ecosystem.config.js
# Edita con tus keys reales

pm2 start ecosystem.config.js
pm2 logs tacos-api
```

## Seguridad

- Nunca subas `ecosystem.config.js`, `certs/`, ni archivos `.pem` o `.key`
- Rota el `API_TOKEN` si se compromete
- El `API_TOKEN` no tiene valor por defecto — el servidor no inicia sin él
