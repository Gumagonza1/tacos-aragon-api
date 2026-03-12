/**
 * services/agente.js – Agente IA central con Claude Opus 4.6 + tool use.
 * Claude puede consultar ventas, WhatsApp, tickets y TIMBRAR facturas directamente.
 */

const Anthropic    = require('@anthropic-ai/sdk');
const cfg          = require('../config');
const loyverse     = require('./loyverse');
const whatsappSvc  = require('./whatsapp');
const facturama    = require('./facturama');

const client = new Anthropic({ apiKey: cfg.ANTHROPIC_KEY });

// Historial de conversaciones por sesión (en memoria)
const sesiones = new Map();

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el asistente inteligente de Tacos Aragón, un restaurante de tacos en Culiacán, Sinaloa.
Tienes acceso a todas las herramientas del negocio y puedes usarlas directamente.

NEGOCIO:
- Nombre: Tacos Aragón
- Horario: Martes–Domingo 6 PM – 11:30 PM (GMT-7)
- Descanso: Lunes

TUS CAPACIDADES (usa las herramientas disponibles):
- Consultar ventas: hoy, ayer, semana, mes, o cualquier rango de fechas con desde/hasta (YYYY-MM-DD)
- Ver detalles de cualquier ticket por número
- Consultar conversaciones de WhatsApp activas
- FACTURAR: recopilar datos del cliente y timbrar el CFDI 4.0 directamente

FACTURACIÓN (CFDI 4.0 – México):
Cuando el usuario pida facturar, recopila ESTOS DATOS ANTES de llamar a crear_factura:
1. Número de ticket/folio del recibo
2. RFC del receptor
3. Razón social (exactamente como aparece en el SAT)
4. Código postal FISCAL (el del domicilio fiscal en el SAT, NO el de entrega)
5. Régimen fiscal:
   - Persona física común: 616 Sin obligaciones fiscales, 612 Act. Empresariales, 625 RESICO
   - Persona moral: 601 General de Ley, 626 RESICO Personas Morales
6. Uso del CFDI: G03 Gastos en general (recomendado), S01 Sin efectos fiscales, G01 Adquisición

Una vez que tengas todos los datos, USA la herramienta crear_factura para timbrar.
Confirma el resultado al usuario con el folio fiscal.

FORMATO DE RESPUESTA (MUY IMPORTANTE):
- Responde SIEMPRE en español, de forma concisa y conversacional
- NUNCA muestres JSON, código, llaves {}, corchetes [], ni bloques de código
- NUNCA copies literalmente el resultado de las herramientas — interpreta y resume
- Usa **negritas** para números y datos clave
- Usa - para listas cuando sea necesario
- Usa emojis con moderación para separar secciones
- El dinero en formato $X,XXX MXN (sin decimales si son .00)
- Sé breve: máximo 8-10 líneas por respuesta`;

// ─── Definición de herramientas ───────────────────────────────────────────────
const HERRAMIENTAS = [
  {
    name: 'obtener_ventas',
    description: 'Obtiene resumen de ventas del negocio. Usa "periodo" para períodos estándar, o "desde"/"hasta" para fechas arbitrarias (formato YYYY-MM-DD). Puedes combinar ambos: si usas "ayer", omite desde/hasta.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: {
          type: 'string',
          enum: ['hoy', 'ayer', 'semana', 'mes'],
          description: 'Período estándar: hoy, ayer, semana (últimos 7 días), mes (mes actual)',
        },
        desde: {
          type: 'string',
          description: 'Fecha inicio en formato YYYY-MM-DD (opcional, para rangos personalizados)',
        },
        hasta: {
          type: 'string',
          description: 'Fecha fin en formato YYYY-MM-DD (opcional, para rangos personalizados)',
        },
      },
    },
  },
  {
    name: 'obtener_ticket',
    description: 'Obtiene el detalle completo de un ticket de venta por su número de folio.',
    input_schema: {
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Número o folio del ticket' },
      },
      required: ['numero'],
    },
  },
  {
    name: 'obtener_whatsapp',
    description: 'Obtiene estadísticas y estado de las conversaciones de WhatsApp.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'buscar_cliente_rfc',
    description: 'Busca si un RFC ya existe como cliente en Facturama. Útil para no crear duplicados.',
    input_schema: {
      type: 'object',
      properties: {
        rfc: { type: 'string', description: 'RFC a buscar' },
      },
      required: ['rfc'],
    },
  },
  {
    name: 'crear_factura',
    description: 'Timbra un CFDI 4.0. Requiere TODOS los datos fiscales del receptor. Llama esta herramienta solo cuando tengas todos los datos.',
    input_schema: {
      type: 'object',
      properties: {
        numero_ticket:  { type: 'string', description: 'Número del ticket de Loyverse' },
        rfc:            { type: 'string', description: 'RFC del receptor' },
        razon_social:   { type: 'string', description: 'Razón social exacta del receptor' },
        codigo_postal:  { type: 'string', description: 'Código postal fiscal del receptor (SAT)' },
        regimen_fiscal: { type: 'string', description: 'Código del régimen fiscal, e.g. 616, 612, 601' },
        uso_cfdi:       { type: 'string', description: 'Clave uso CFDI: G03, S01, G01, etc.' },
      },
      required: ['numero_ticket', 'rfc', 'razon_social', 'codigo_postal', 'regimen_fiscal', 'uso_cfdi'],
    },
  },
];

// ─── Ejecutores de herramientas ───────────────────────────────────────────────
async function ejecutar(nombre, args) {
  switch (nombre) {

    case 'obtener_ventas': {
      // Zona horaria GMT-7 (Hermosillo)
      const TZ_OFFSET = -7 * 60;
      function localToday() {
        const now = new Date();
        const local = new Date(now.getTime() + (TZ_OFFSET - now.getTimezoneOffset()) * 60000);
        local.setHours(0, 0, 0, 0);
        return local;
      }

      let desdeDate, hastaDate;

      if (args.desde && args.hasta) {
        // Rango personalizado: interpretar como fechas locales GMT-7
        desdeDate = new Date(args.desde + 'T00:00:00-07:00');
        hastaDate = new Date(args.hasta + 'T23:59:59-07:00');
      } else {
        const hoy = localToday();
        hastaDate = new Date(); // ahora exacto
        if (args.periodo === 'ayer') {
          desdeDate = new Date(hoy); desdeDate.setDate(hoy.getDate() - 1);
          hastaDate = new Date(hoy); hastaDate.setMilliseconds(-1); // fin de ayer
        } else if (args.periodo === 'semana') {
          desdeDate = new Date(hoy); desdeDate.setDate(hoy.getDate() - 7);
        } else if (args.periodo === 'mes') {
          const now2 = new Date();
          desdeDate = new Date(now2.getFullYear(), now2.getMonth(), 1);
        } else {
          // hoy por defecto
          desdeDate = new Date(hoy);
        }
      }

      const recibos = await loyverse.obtenerRecibos(desdeDate.toISOString(), hastaDate.toISOString());
      const resumen = loyverse.calcularResumen(recibos);
      return JSON.stringify(resumen, null, 2);
    }

    case 'obtener_ticket': {
      const ticket = await loyverse.obtenerRecibo(args.numero);
      return JSON.stringify(ticket, null, 2);
    }

    case 'obtener_whatsapp': {
      const stats = whatsappSvc.estadisticas();
      return JSON.stringify(stats, null, 2);
    }

    case 'buscar_cliente_rfc': {
      try {
        const cliente = await facturama.buscarCliente(args.rfc);
        return JSON.stringify({ encontrado: true, cliente });
      } catch {
        return JSON.stringify({ encontrado: false, mensaje: 'RFC no registrado en Facturama, se creará nuevo.' });
      }
    }

    case 'crear_factura': {
      const ticket = await loyverse.obtenerRecibo(args.numero_ticket);
      const resultado = await facturama.timbrarFactura(ticket, {
        rfc:           args.rfc,
        razonSocial:   args.razon_social,
        codigoPostal:  args.codigo_postal,
        regimenFiscal: args.regimen_fiscal,
        usoCfdi:       args.uso_cfdi,
      });
      return JSON.stringify(resultado, null, 2);
    }

    default:
      return JSON.stringify({ error: `Herramienta desconocida: ${nombre}` });
  }
}

// ─── Contexto de fecha/hora del dispositivo ───────────────────────────────────
function buildSystemPrompt(deviceTime) {
  if (!deviceTime) return SYSTEM_PROMPT;
  try {
    const dt = new Date(deviceTime);
    const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const diaName = DIAS[dt.getDay()];
    const diaNum  = dt.getDate();
    const mes     = MESES[dt.getMonth()];
    const anio    = dt.getFullYear();
    const hora    = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    // Día anterior
    const ayer = new Date(dt); ayer.setDate(dt.getDate() - 1);
    const ayerName = DIAS[ayer.getDay()];
    const ayerNum  = ayer.getDate();
    const ayerMes  = MESES[ayer.getMonth()];
    const fechaISO = `${anio}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(diaNum).padStart(2,'0')}`;
    const ayerISO  = `${ayer.getFullYear()}-${String(ayer.getMonth()+1).padStart(2,'0')}-${String(ayerNum).padStart(2,'0')}`;

    return SYSTEM_PROMPT + `

FECHA Y HORA ACTUAL (zona horaria GMT-7, del dispositivo del usuario):
- Hoy: ${diaName} ${diaNum} de ${mes} de ${anio} — ${hora} hrs — ISO: ${fechaISO}
- Ayer: ${ayerName} ${ayerNum} de ${ayerMes} — ISO: ${ayerISO}
- Para calcular "el martes pasado", "la semana pasada", etc. usa hoy (${diaName} ${fechaISO}) como referencia
- Cuando uses obtener_ventas con fechas específicas, usa el formato desde/hasta con ISO YYYY-MM-DD`;
  } catch {
    return SYSTEM_PROMPT;
  }
}

// ─── Chat principal con loop agentico ─────────────────────────────────────────
async function chatTexto(sessionId, mensaje, deviceTime) {
  if (!sesiones.has(sessionId)) sesiones.set(sessionId, []);
  const historial = sesiones.get(sessionId);

  // Agregar mensaje del usuario al historial
  historial.push({ role: 'user', content: mensaje });

  // Copia de trabajo para el loop (no queremos contaminar el historial con tool_use blocks)
  const messages = historial.map(m => ({ role: m.role, content: m.content }));

  let respuestaFinal = '';

  // Loop agentico: Claude llama herramientas hasta terminar
  while (true) {
    const response = await client.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 2048,
      system:     buildSystemPrompt(deviceTime),
      tools:      HERRAMIENTAS,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      respuestaFinal = textBlock ? textBlock.text : '(sin respuesta)';
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const resultados = [];
      for (const tool of toolBlocks) {
        let resultado;
        try {
          resultado = await ejecutar(tool.name, tool.input);
        } catch (e) {
          resultado = JSON.stringify({ error: e.message });
        }
        resultados.push({
          type:        'tool_result',
          tool_use_id: tool.id,
          content:     resultado,
        });
      }
      messages.push({ role: 'user', content: resultados });
      continue;
    }

    // Otro stop_reason (max_tokens, etc.)
    const textBlock = response.content.find(b => b.type === 'text');
    respuestaFinal = textBlock ? textBlock.text : '(respuesta incompleta)';
    break;
  }

  // Guardar solo texto en el historial (no los bloques de herramientas)
  historial.push({ role: 'assistant', content: respuestaFinal });
  if (historial.length > 40) historial.splice(0, 2);
  sesiones.set(sessionId, historial);

  return respuestaFinal;
}

// ─── Resumen ejecutivo ────────────────────────────────────────────────────────
async function generarResumen(periodo = 'hoy') {
  const pregunta = `Genera un resumen ejecutivo del negocio para el período: ${periodo}.
Consulta las ventas con la herramienta, destaca lo más importante y sugiere una acción si aplica.`;
  return chatTexto(`resumen-${Date.now()}`, pregunta);
}

module.exports = { chatTexto, generarResumen };
