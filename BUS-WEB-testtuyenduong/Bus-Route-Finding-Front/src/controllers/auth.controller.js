// [ADDED] Controller đăng ký / đăng nhập (hash mật khẩu, trả JWT) theo report
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

async function register(req, res) {
  // [SỬA] Đảm bảo đọc body từ req (tránh body undefined khi middleware chưa parse)
  const body = req.body || {};
  const email = (body.email && typeof body.email === 'string') ? body.email.trim() : '';
  const password = body.password;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email.toLowerCase(), hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({ userId: String(user.id), token, user: { id: user.id, email: user.email } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email này đã được đăng ký' });
    }
    console.error('Register error', err);
    // [SỬA] Trả lỗi rõ hơn khi DB lỗi (ví dụ: connection refused) để debug
    const message = process.env.NODE_ENV === 'development' && err.message
      ? err.message
      : 'Đăng ký thất bại. Kiểm tra kết nối database và thử lại.';
    return res.status(500).json({ error: message });
  }
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Incorrect email or password' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect email or password' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}

module.exports = { register, login };
