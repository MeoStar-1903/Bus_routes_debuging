// [ADDED] Middleware xác thực JWT theo report (NFR3)
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'bus-route-finding-secret-change-in-production';

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Unauthorized: user not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

// [ADDED] Middleware auth tùy chọn: gắn req.user nếu có token hợp lệ, không trả 401 nếu không có
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length > 0) req.user = result.rows[0];
  } catch (_) {}
  next();
}

module.exports = { authMiddleware, optionalAuth, JWT_SECRET };
