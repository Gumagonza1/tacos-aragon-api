'use strict';

/**
 * services/claude-runner.js — Ejecuta claude -p para chat conversacional (Linux/Docker).
 */

const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const crypto     = require('crypto');

const CLAUDE_TIMEOUT_MS   = 2 * 60 * 1000;
const INACTIVITY_MS       = 90 * 1000;
const WATCHDOG_INTERVAL   = 15 * 1000;
const SESSION_TTL_MS      = 60 * 60 * 1000;
const SESSION_MAX_MENSAJES = 20;

function log(msg) {
  const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' });
  console.log(`[${ts}] [claude-runner] ${msg}`);
}

const sesiones = new Map();

function obtenerOCrearSesion(appSessionId) {
  const ahora = Date.now();
  const existente = sesiones.get(appSessionId);
  if (existente &&
      (ahora - existente.creadoEn) < SESSION_TTL_MS &&
      existente.mensajes < SESSION_MAX_MENSAJES) {
    existente.ultimoUso = ahora;
    return { claudeSessionId: existente.claudeSessionId, esNueva: false, sesion: existente };
  }
  const claudeSessionId = crypto.randomUUID();
  const nueva = { claudeSessionId, creadoEn: ahora, ultimoUso: ahora, mensajes: 0 };
  sesiones.set(appSessionId, nueva);
  return { claudeSessionId, esNueva: true, sesion: nueva };
}

function getSesionInfo(appSessionId) {
  const s = sesiones.get(appSessionId);
  if (!s) return null;
  const ahora = Date.now();
  if ((ahora - s.creadoEn) >= SESSION_TTL_MS) return null;
  return {
    claudeSessionId: s.claudeSessionId,
    mensajes: s.mensajes,
    restanteMin: Math.round((SESSION_TTL_MS - (ahora - s.creadoEn)) / 60000),
  };
}

function resetSesion(appSessionId) {
  if (appSessionId) sesiones.delete(appSessionId);
  else sesiones.clear();
}

function procesarEventoJSON(event, finalOutputRef) {
  try {
    switch (event.type) {
      case 'assistant':
        for (const block of (event.message?.content || [])) {
          if (block.type === 'tool_use') log(`  🔧 [tool] ${block.name}`);
          else if (block.type === 'text' && block.text?.trim()) log(`  💬 [text] ${block.text.slice(0, 200)}`);
        }
        break;
      case 'result':
        if (event.result) finalOutputRef.value = event.result;
        if (event.cost_usd != null) log(`  💰 $${event.cost_usd.toFixed(4)}`);
        break;
    }
  } catch {}
}

function matarArbol(pid) {
  if (!pid) return;
  try { process.kill(pid, 'SIGKILL'); } catch {}
  try { process.kill(-pid, 'SIGKILL'); } catch {}
}

const _procActivos = new Set();
process.on('exit', () => { for (const p of _procActivos) matarArbol(p.pid); });
process.on('SIGTERM', () => { for (const p of _procActivos) matarArbol(p.pid); process.exit(0); });

async function ejecutarChat({ appSessionId, systemPrompt, userMessage }) {
  const { claudeSessionId, esNueva, sesion } = obtenerOCrearSesion(appSessionId);
  sesion.mensajes++;

  const fullPrompt = esNueva
    ? `${systemPrompt}\n\n${userMessage}`
    : userMessage;

  log(`[${appSessionId}] msg #${sesion.mensajes} (${esNueva ? 'nueva' : 'activa'})`);

  const tmpId     = crypto.randomBytes(6).toString('hex');
  const tmpPrompt = path.join(os.tmpdir(), `chat-prompt-${tmpId}.txt`);

  fs.writeFileSync(tmpPrompt, fullPrompt, 'utf-8');

  const cmd = `cat "${tmpPrompt}" | claude -p` +
    ` --output-format stream-json` +
    ` --verbose` +
    ` --model sonnet` +
    ` --session-id ${claudeSessionId}` +
    ` --permission-mode bypassPermissions` +
    ` --max-turns 10` +
    ` --max-budget-usd 0.50`;

  function cleanup() {
    try { fs.unlinkSync(tmpPrompt); } catch {}
  }

  return new Promise((resolve) => {
    let rawOutput      = '';
    let lineBuffer     = '';
    let stderrBuf      = '';
    let finished       = false;
    let lastActivityAt = Date.now();
    const finalOutputRef = { value: '' };

    const proc = spawn('/bin/sh', ['-c', cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const procEntry = { pid: proc.pid };
    _procActivos.add(procEntry);

    proc.stdout.on('data', (data) => {
      lastActivityAt = Date.now();
      const chunk = data.toString();
      rawOutput  += chunk;
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { procesarEventoJSON(JSON.parse(line), finalOutputRef); } catch {}
      }
    });

    proc.stderr.on('data', (data) => {
      lastActivityAt = Date.now();
      const chunk = data.toString().trim();
      if (!chunk) return;
      stderrBuf += chunk + '\n';
      log(`  ⚠️ [stderr] ${chunk.slice(0, 300)}`);
      if (chunk.toLowerCase().includes('session') &&
          (chunk.toLowerCase().includes('already in use') || chunk.toLowerCase().includes('in use'))) {
        log(`  🔄 Sesión ocupada — invalidando`);
        sesiones.delete(appSessionId);
        if (!finished) {
          clearInterval(watchdog);
          clearTimeout(hardCap);
          finished = true;
          matarArbol(proc.pid);
          _procActivos.delete(procEntry);
          cleanup();
          resolve({ ok: false, output: 'SESSION_IN_USE', exitCode: -5, claudeSessionId });
        }
      }
    });

    const watchdog = setInterval(() => {
      if (finished) { clearInterval(watchdog); return; }
      if (Date.now() - lastActivityAt >= INACTIVITY_MS) {
        clearInterval(watchdog); clearTimeout(hardCap);
        finished = true;
        matarArbol(proc.pid);
        _procActivos.delete(procEntry);
        cleanup();
        sesiones.delete(appSessionId);
        resolve({ ok: false, output: finalOutputRef.value || '(sin respuesta — timeout)', exitCode: -2, claudeSessionId });
      }
    }, WATCHDOG_INTERVAL);

    const hardCap = setTimeout(() => {
      if (!finished) {
        clearInterval(watchdog);
        finished = true;
        matarArbol(proc.pid);
        _procActivos.delete(procEntry);
        cleanup();
        sesiones.delete(appSessionId);
        resolve({ ok: false, output: finalOutputRef.value || '(sin respuesta — timeout)', exitCode: -2, claudeSessionId });
      }
    }, CLAUDE_TIMEOUT_MS);

    proc.on('close', (code) => {
      if (!finished) {
        finished = true;
        clearInterval(watchdog); clearTimeout(hardCap);
        _procActivos.delete(procEntry);
        cleanup();
        resolve({
          ok: code === 0 && !!finalOutputRef.value.trim(),
          output: finalOutputRef.value.trim() || stderrBuf.trim() || '(sin respuesta)',
          exitCode: code || 0,
          claudeSessionId,
        });
      }
    });

    proc.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearInterval(watchdog); clearTimeout(hardCap);
        _procActivos.delete(procEntry);
        cleanup();
        resolve({ ok: false, output: `ERROR al iniciar claude: ${err.message}`, exitCode: -3, claudeSessionId });
      }
    });
  });
}

module.exports = { ejecutarChat, getSesionInfo, resetSesion };
