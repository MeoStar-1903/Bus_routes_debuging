/**
 * Tạo shapes (hình học tuyến) từ OSRM khi chưa có shapes.txt.
 * Với mỗi tuyến (route_id), lấy thứ tự bến từ một chuyến, gọi OSRM route để lấy geometry đường bộ, rồi insert vào gtfs.shapes.
 *
 * Chạy sau khi đã import và post-import. Cách chạy: node database/generate-shapes-from-osrm.js
 * Tùy chọn: --delay=1500 (ms giữa mỗi request, mặc định 2000)
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

const OSRM_BASE = process.env.OSRM_ROUTE_URL || 'https://router.project-osrm.org';
const DELAY_MS = parseInt(process.argv.find((a) => a.startsWith('--delay='))?.split('=')[1] || '2000', 10);

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
          reject(new Error('Invalid JSON'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * OSRM route: GET /route/v1/driving/{lon1},{lat1};{lon2},{lat2};...?overview=full&geometries=geojson
 * Trả về geometry.coordinates = [[lon, lat], ...]
 */
async function osrmRoute(points) {
  if (!points || points.length < 2) return null;
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const data = await fetchUrl(url);
  if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) return null;
  return data.routes[0].geometry.coordinates;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const client = await pool.connect();
  try {
    const routesRes = await client.query(
      `SELECT route_id FROM gtfs.routes ORDER BY route_id`
    );
    let ok = 0;
    let fail = 0;
    for (const row of routesRes.rows) {
      const routeId = row.route_id;
      const tripRes = await client.query(
        `SELECT t.trip_id FROM gtfs.trips t
         JOIN gtfs.stop_times_merged st ON st.trip_id = t.trip_id
         WHERE t.route_id = $1
         GROUP BY t.trip_id
         ORDER BY MIN(st.stop_sequence)
         LIMIT 1`,
        [routeId]
      );
      if (tripRes.rows.length === 0) continue;
      const tripId = tripRes.rows[0].trip_id;
      const stopsRes = await client.query(
        `SELECT st.stop_id, st.stop_sequence,
         COALESCE(s.stop_lat_snapped, s.stop_lat) AS stop_lat,
         COALESCE(s.stop_lon_snapped, s.stop_lon) AS stop_lon
         FROM gtfs.stop_times_merged st
         JOIN gtfs.stops_merged s ON s.stop_id = st.stop_id
         WHERE st.trip_id = $1
         ORDER BY st.stop_sequence`,
        [tripId]
      );
      const points = stopsRes.rows.map((r) => ({
        lat: parseFloat(r.stop_lat),
        lon: parseFloat(r.stop_lon),
      }));
      if (points.length < 2) continue;
      try {
        const coords = await osrmRoute(points);
        if (!coords || coords.length < 2) {
          fail++;
          continue;
        }
        await client.query('DELETE FROM gtfs.shapes WHERE shape_id = $1', [routeId]);
        for (let i = 0; i < coords.length; i++) {
          const [lon, lat] = coords[i];
          await client.query(
            `INSERT INTO gtfs.shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled)
             VALUES ($1, $2, $3, $4, NULL) ON CONFLICT (shape_id, shape_pt_sequence) DO UPDATE SET
             shape_pt_lat = EXCLUDED.shape_pt_lat, shape_pt_lon = EXCLUDED.shape_pt_lon`,
            [routeId, lat, lon, i + 1]
          );
        }
        await client.query(
          `UPDATE gtfs.trips SET shape_id = $1 WHERE route_id = $2`,
          [routeId, routeId]
        );
        ok++;
        if (ok % 20 === 0) console.log('Shapes:', ok, '/', routesRes.rows.length);
      } catch (err) {
        fail++;
        if (fail <= 3) console.warn('Skip', routeId, err.message);
      }
      await sleep(DELAY_MS);
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
