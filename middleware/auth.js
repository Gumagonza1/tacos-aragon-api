const crypto = require('crypto');
const cfg    = require('../config');

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

module.exports = function auth(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!token || !timingSafeEqual(token, cfg.API_TOKEN)) {
    console.warn(`[auth] Acceso denegado | IP: ${req.ip} | ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
};
