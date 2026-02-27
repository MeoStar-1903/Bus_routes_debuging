// [ADDED] File khởi tạo bảng ứng dụng (users, ratings, route_search_history) theo report
const pool = require('../db');

const initAppTables = async () => {
  // [SỬA] Dùng let + release trong finally chỉ khi có client (tránh lỗi khi pool.connect() thất bại)
  let client = await pool.connect();
  try {
    // [ADDED] Bảng users - lưu tài khoản (password hash)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // [ADDED] Bảng route_search_history - lịch sử tìm kiếm
    await client.query(`
      CREATE TABLE IF NOT EXISTS route_search_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        origin_stop_id VARCHAR(64),
        destination_stop_id VARCHAR(64),
        origin_name VARCHAR(255),
        destination_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // [ADDED] Bảng ratings - đánh giá tuyến
    await client.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        route_id VARCHAR(64) NOT NULL,
        rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('App tables ready');
  } finally {
    if (client) client.release();
  }
};

module.exports = { initAppTables };
