/**
 * Snap tọa độ các bến trong gtfs.stops_merged lên đường (OSRM nearest).
 * Chạy sau khi đã import và post-import. Cập nhật stop_lat_snapped, stop_lon_snapped.
 *
 * Cách chạy: node database/snap-stops-to-road.js
 * Tùy chọn: --only-null (chỉ snap bến chưa có snapped), --delay=500 (ms giữa mỗi request, mặc định 1000)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

const OSRM_BASE = process.env.OSRM_NEAREST_URL || 'https://router.project-osrm.org';
const DELAY_MS = parseInt(process.argv.find((a) => a.startsWith('--delay='))?.split('=')[1] || '1000', 10);
const ONLY_NULL = process.argv.includes('--only-null');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + data.slice(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

/**
 * OSRM nearest: GET /nearest/v1/driving/{lon},{lat}
 * Trả về waypoints[0].location = [lon, lat] (điểm gần nhất trên đường).
 */
async function osrmNearest(lon, lat) {
  const url = `${OSRM_BASE}/nearest/v1/driving/${lon},${lat}`;
  const data = await fetchUrl(url);
  if (data.code !== 'Ok' && data.code !== 'ok') {
    throw new Error(data.code || 'OSRM error');
  }
  const loc = data.waypoints?.[0]?.location;
  if (!loc || !Array.isArray(loc) || loc.length < 2) {
    throw new Error('No waypoint location');
  }
  return { lon: loc[0], lat: loc[1] };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const client = await pool.connect();
  try {
    const whereClause = ONLY_NULL ? 'WHERE stop_lat_snapped IS NULL' : '';
    const res = await client.query(
      `SELECT stop_id, stop_lat, stop_lon FROM gtfs.stops_merged ${whereClause} ORDER BY stop_id`
    );
    const stops = res.rows;
    console.log('Stops to snap:', stops.length, ONLY_NULL ? '(chỉ bến chưa snap)' : '');
    if (stops.length === 0) {
      console.log('Không có bến cần xử lý.');
      return;
    }

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const lat = parseFloat(s.stop_lat);
      const lon = parseFloat(s.stop_lon);
      if (isNaN(lat) || isNaN(lon)) {
        fail++;
        continue;
      }
      try {
        const snapped = await osrmNearest(lon, lat);
        await client.query(
          `UPDATE gtfs.stops_merged SET stop_lat_snapped = $1, stop_lon_snapped = $2 WHERE stop_id = $3`,
          [snapped.lat, snapped.lon, s.stop_id]
        );
        ok++;
        if (ok % 100 === 0) console.log('Snapped', ok, '/', stops.length);
      } catch (err) {
        fail++;
        if (fail <= 5) console.warn('Skip', s.stop_id, err.message);
      }
      if (i < stops.length - 1) await sleep(DELAY_MS);
    }

    console.log('Xong. Thành công:', ok, 'Lỗi/bỏ qua:', fail);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
