# CLAUDE.md — tacos-aragon-api

API de soporte del ecosistema Tacos Aragón. Corre en `http://localhost:3001`.

## Propósito
- Facturación CFDI vía Facturama PAC: `POST /api/facturar`
- Autenticación: header `x-api-token`
- Consumida por `bot-tacos` cuando el cliente solicita factura

## Estructura
| Carpeta/Archivo | Contenido |
|-----------------|-----------|
| `routes/` | Endpoints Express |
| `services/` | Lógica de negocio (Facturama, Loyverse) |
| `middleware/` | Auth, manejo de errores |
| `config.js` | Configuración general (lee de env vars) |
| `certs/` | Certificados SAT — NO subir a git |
| `ecosystem.config.js` | PM2 con tokens reales — NO subir a git |

## Reglas de trabajo
- NO subir a git: `ecosystem.config.js` con tokens reales, carpeta `certs/` con certificados SAT
- La API debe estar aprobada por Facturama **antes** de emitir CFDIs en producción
- Variables de entorno sensibles van solo en `ecosystem.config.js` local, nunca hardcodeadas en código
- El endpoint `/api/facturar` no debe activarse en el bot hasta que esta API esté en producción aprobada
