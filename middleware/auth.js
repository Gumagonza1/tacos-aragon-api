const cfg = require('../config');

module.exports = function auth(req, res, next) {
  const token = req.headers['x-api-token'] || req.query.token;
  if (!token || token !== cfg.API_TOKEN) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
};
