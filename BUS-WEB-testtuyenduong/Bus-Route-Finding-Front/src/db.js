require('dotenv').config();
const { Pool } = require('pg');

// [SỬA] Dùng giá trị mặc định khi thiếu .env để Pool không nhận undefined (tránh lỗi kết nối lạ)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  connectionTimeoutMillis: 5000, // [SỬA] Tránh treo khi PostgreSQL không chạy hoặc sai mật khẩu
});

// [SỬA] Bắt lỗi pool (ECONNRESET, auth failed...) để không crash app; chỉ log cảnh báo
pool.on('error', (err) => {
  console.warn('DB pool error (auth/ratings/history may be disabled):', err.message);
});

// [SỬA] Không chạy test query ngay khi load module — kết nối sẽ được tạo khi gọi init/API.
// Tránh "password authentication failed" + ECONNRESET in ra ngay lúc start; lỗi DB được xử lý trong initAppTables try/catch.
module.exports = pool;
