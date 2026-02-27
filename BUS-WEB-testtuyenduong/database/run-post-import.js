/**
 * Chạy post-import.sql (gộp bến, tạo edges, indexes, views).
 * Chạy sau khi đã chạy: schema.sql và import-gtfs.js
 * Cách chạy: node database/run-post-import.js
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const frontNodeModules = path.join(projectRoot, 'Bus-Route-Finding-Front', 'node_modules');
if (fs.existsSync(frontNodeModules)) {
  module.paths.unshift(frontNodeModules);
}
const { Pool } = require('pg');

const frontEnv = path.join(projectRoot, 'Bus-Route-Finding-Front', '.env');
const rootEnv = path.join(projectRoot, '.env');
if (fs.existsSync(frontEnv)) require('dotenv').config({ path: frontEnv });
else if (fs.existsSync(rootEnv)) require('dotenv').config({ path: rootEnv });
else require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
});

const sqlPath = path.join(__dirname, 'post-import.sql');

async function run() {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s.length > 0);
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO gtfs, public');
    for (const stmt of statements) {
      if (!stmt) continue;
      try {
        await client.query(stmt + ';');
        console.log('OK:', stmt.slice(0, 55).replace(/\s+/g, ' ').trim() + '...');
      } catch (err) {
        console.error('Error:', err.message);
        console.error('Statement:', stmt.slice(0, 200));
        throw err;
      }
    }
    await client.query('SET search_path TO public');
    console.log('\nPost-import hoàn tất.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
