# CLAUDE.md — tacos-aragon-api

API central REST del ecosistema Tacos Aragón (Express.js, puerto 3001).

## Propósito
Backend que conecta app móvil, bot de WhatsApp, Loyverse POS, Facturama y agente IA.

## Estructura
| Carpeta | Contenido |
|---------|-----------|
| `index.js` | Entry point, Express + WebSocket + rate limiting |
| `config.js` | Carga de credenciales y validación |
| `middleware/auth.js` | Autenticación timing-safe por token |
| `routes/` | Endpoints: dashboard, ventas, whatsapp, facturacion, agente, contabilidad, interno (recursos) |
| `services/` | Lógica de negocio: loyverse, facturama, agente, whatsapp |
| `jobs/` | Cron: prellenar_contabilidad (2:05 AM diario) |

## Reglas de trabajo
- Timezone GMT-7
- Rate limits: 100/15min global, 30/15min IA, 20/15min facturación
- Token auth con `crypto.timingSafeEqual()`
- No exponer detalles de error en respuestas 500

---

## MCP Prompt Primitives

Servidor: `../mcp-prompts-server/` — ejecutar con `python server.py`

### Prompts asignados a este proyecto

| # | Prompt | Archivo | Descripción | Función/Endpoint que cubre |
|---|--------|---------|-------------|---------------------------|
| 1 | `agente_chat_negocio` | `prompts/api.py` | Agente IA conversacional con tools | `services/agente.js:chatTexto()` → `POST /api/agente/chat` |
| 2 | `generar_resumen_ejecutivo` | `prompts/api.py` | Resumen ejecutivo por periodo | `services/agente.js:generarResumen()` → `GET /api/agente/resumen` |
| 3 | `consultar_ventas` | `prompts/api.py` | Consulta y análisis de ventas | `routes/ventas.js` → `GET /api/ventas` |
| 4 | `prellenar_contabilidad` | `prompts/api.py` | Auto-categoriza ventas para CFO | `jobs/prellenar_contabilidad.js` (cron 2:05 AM) |
| 5 | `procesar_solicitud_factura` | `prompts/api.py` | Valida y procesa solicitud de CFDI | `routes/facturacion.js` → `POST /api/facturar` |

### Detalle de cada prompt

#### 1. `agente_chat_negocio`
- **Argumentos**: `mensaje`, `session_id`, `hora_dispositivo`
- **System prompt**: Agente con 5 tools (obtener_ventas, obtener_ticket, obtener_whatsapp, buscar_cliente_rfc, crear_factura). Responde en español, usa ** para énfasis, $ para montos
- **Servicio**: `services/agente.js` — loop agentic con Claude: enviar → tool_use → ejecutar → continuar hasta end_turn
- **Tools definidos**:
  - `obtener_ventas`: periodo o rango YYYY-MM-DD
  - `obtener_ticket`: número de ticket
  - `obtener_whatsapp`: stats y estado de conversaciones
  - `buscar_cliente_rfc`: verificar RFC en Facturama
  - `crear_factura`: emitir CFDI con datos fiscales completos

#### 2. `generar_resumen_ejecutivo`
- **Argumentos**: `periodo` (hoy/semana/mes), `datos_ventas`, `datos_whatsapp`
- **System prompt**: Máximo 300 palabras, incluye KPIs (total, ticket promedio, top 3 productos, canal principal), comparativa vs periodo anterior. Compatible con text-to-speech
- **Endpoint**: `GET /api/agente/resumen?periodo=hoy`

#### 3. `consultar_ventas`
- **Argumentos**: `periodo`, `desde`, `hasta`, `filtros` (tipo_pago, dining, employee_id), `agrupar`
- **System prompt**: Analiza recibos Loyverse. Calcula totales, top 5 productos, desglose por canal/pago/empleado. La semana inicia el martes
- **Endpoints**: `GET /api/ventas`, `/api/ventas/resumen`, `/api/ventas/grafica`

#### 4. `prellenar_contabilidad`
- **Argumentos**: `fecha`, `recibos`, `movimientos_caja`
- **System prompt**: Categoriza recibos por método de pago → cuenta contable. PAY_IN "tc/ta" → ventas_efectivo, PAY_OUT "compra" → materia_prima, PAY_OUT "nomina" → nomina
- **Job**: `jobs/prellenar_contabilidad.js` — cron diario 2:05 AM, envía a CFO Agent

#### 5. `procesar_solicitud_factura`
- **Argumentos**: `numero_ticket`, `datos_cliente` (RFC, razón social, email, CP, régimen, uso CFDI)
- **System prompt**: Valida RFC (regex), verifica ticket en Loyverse, verifica límite 2/día, busca/crea cliente en Facturama
- **Endpoint**: `POST /api/facturar`
