/**
 * Import dữ liệu GTFS từ folder Dataset (hanoi_gtfs_am, hanoi_gtfs_md, hanoi_gtfs_pm)
 * vào PostgreSQL. Chạy từ thư mục gốc project: node database/import-gtfs.js
 *
 * Yêu cầu: đã chạy schema.sql và cấu hình .env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT)
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
// Dùng node_modules của Bus-Route-Finding-Front khi chạy từ thư mục gốc (pg, dotenv)
const frontNodeModules = path.join(projectRoot, 'Bus-Route-Finding-Front', 'node_modules');
if (fs.existsSync(frontNodeModules)) {
  module.paths.unshift(frontNodeModules);
}
const { Pool } = require('pg');

// Load .env từ thư mục project hoặc Bus-Route-Finding-Front
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

const DATASET_PATH = process.env.DATASET_PATH || path.join(projectRoot, 'Dataset');
const FEEDS = ['hanoi_gtfs_am', 'hanoi_gtfs_md', 'hanoi_gtfs_pm'];

// Kiểm tra tọa độ Hà Nội (tránh lỗi constraint)
const HANOI_LAT_MIN = 20.5, HANOI_LAT_MAX = 21.5;
const HANOI_LON_MIN = 105.3, HANOI_LON_MAX = 106.2;
function isValidCoord(lat, lon) {
  const la = parseFloat(lat), lo = parseFloat(lon);
  return !isNaN(la) && !isNaN(lo) &&
    la >= HANOI_LAT_MIN && la <= HANOI_LAT_MAX &&
    lo >= HANOI_LON_MIN && lo <= HANOI_LON_MAX;
}

function readCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const obj = {};
    headers.forEach((h, j) => (obj[h] = values[j] != null ? values[j].trim() : ''));
    rows.push(obj);
  }
  return rows;
}

function parseDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  const y = yyyymmdd.slice(0, 4), m = yyyymmdd.slice(4, 6), d = yyyymmdd.slice(6, 8);
  return `${y}-${m}-${d}`;
}

// Chuẩn hóa giá trị smallint từ CSV (tránh '' gây lỗi PostgreSQL)
function toSmallInt(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? null : n;
}
function toInt(v, def = 0) {
  if (v === '' || v === null || v === undefined) return def;
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? def : n;
}

async function run() {
  const client = await pool.connect();
  let stats = { routes: 0, stops: 0, trips: 0, stop_times: 0, calendar: 0, shapes: 0, transfers: 0 };

  try {
    // 1. Calendar (chỉ cần import 1 lần từ feed đầu)
    const calendarPath = path.join(DATASET_PATH, FEEDS[0], 'calendar.txt');
    if (fs.existsSync(calendarPath)) {
      const rows = readCSV(calendarPath);
      for (const r of rows) {
        if (!r.service_id) continue;
        await client.query(
          `INSERT INTO gtfs.calendar (service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
           VALUES ($1, $2::smallint, $3::smallint, $4::smallint, $5::smallint, $6::smallint, $7::smallint, $8::smallint, $9::date, $10::date)
           ON CONFLICT (service_id) DO NOTHING`,
          [
            r.service_id,
            toInt(r.monday), toInt(r.tuesday), toInt(r.wednesday), toInt(r.thursday),
            toInt(r.friday), toInt(r.saturday), toInt(r.sunday),
            parseDate(r.start_date), parseDate(r.end_date),
          ]
        );
        stats.calendar++;
      }
      console.log('Calendar:', stats.calendar, 'rows');
    }

    for (const feed of FEEDS) {
      const feedPath = path.join(DATASET_PATH, feed);
      if (!fs.existsSync(feedPath)) {
        console.log('Skip (not found):', feed);
        continue;
      }
      console.log('Processing feed:', feed);

      // 2. Routes
      const routesPath = path.join(feedPath, 'routes.txt');
      if (fs.existsSync(routesPath)) {
        const rows = readCSV(routesPath);
        for (const r of rows) {
          if (!r.route_id) continue;
          await client.query(
            `INSERT INTO gtfs.routes (route_id, agency_id, route_short_name, route_long_name, route_desc, route_type, route_url, route_color, route_text_color)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (route_id) DO NOTHING`,
            [
              r.route_id, r.agency_id || null, r.route_short_name || null, r.route_long_name || null,
              r.route_desc || null, toInt(r.route_type, 3), r.route_url || null, r.route_color || null, r.route_text_color || null,
            ]
          );
          stats.routes++;
        }
      }

      // 3. Stops (chỉ thêm nếu tọa độ hợp lệ - khớp bản đồ Hà Nội)
      const stopsPath = path.join(feedPath, 'stops.txt');
      if (fs.existsSync(stopsPath)) {
        const rows = readCSV(stopsPath);
        for (const r of rows) {
          if (!r.stop_id || !r.stop_name) continue;
          if (!isValidCoord(r.stop_lat, r.stop_lon)) continue;
          const lat = parseFloat(r.stop_lat), lon = parseFloat(r.stop_lon);
          await client.query(
            `INSERT INTO gtfs.stops (stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (stop_id) DO NOTHING`,
            [
              r.stop_id, r.stop_code || null, r.stop_name, r.stop_desc || null, lat, lon,
              r.zone_id || null, r.stop_url || null, toInt(r.location_type, 0), r.parent_station || null,
            ]
          );
          stats.stops++;
        }
      }

      // 4. Trips
      const tripsPath = path.join(feedPath, 'trips.txt');
      if (fs.existsSync(tripsPath)) {
        const rows = readCSV(tripsPath);
        for (const r of rows) {
          if (!r.trip_id || !r.route_id) continue;
          await client.query(
            `INSERT INTO gtfs.trips (trip_id, route_id, service_id, trip_headsign, direction_id, block_id, shape_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (trip_id) DO NOTHING`,
            [
              r.trip_id, r.route_id, r.service_id || 'FULLW', r.trip_headsign || null,
              toSmallInt(r.direction_id), r.block_id || null, r.shape_id || null,
            ]
          );
          stats.trips++;
        }
      }

      // 5. Stop_times (batch insert để nhanh)
      const stopTimesPath = path.join(feedPath, 'stop_times.txt');
      if (fs.existsSync(stopTimesPath)) {
        const rows = readCSV(stopTimesPath);
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH).filter((r) => r.trip_id && r.stop_id);
          if (batch.length === 0) continue;
          const values = batch.map((r, idx) => {
            const n = idx * 9;
            return `($${n+1}, $${n+2}::int, $${n+3}, $${n+4}, $${n+5}, $${n+6}, $${n+7}::smallint, $${n+8}::smallint, $${n+9})`;
          }).join(', ');
          const flat = batch.flatMap((r) => [
            r.trip_id, toInt(r.stop_sequence, 0), r.arrival_time || '', r.departure_time || '', r.stop_id,
            r.stop_headsign || null, toInt(r.pickup_type, 0), toInt(r.drop_off_type, 0), r.shape_dist_traveled === '' || r.shape_dist_traveled == null ? null : parseFloat(r.shape_dist_traveled),
          ]);
          await client.query(
            `INSERT INTO gtfs.stop_times (trip_id, stop_sequence, arrival_time, departure_time, stop_id, stop_headsign, pickup_type, drop_off_type, shape_dist_traveled)
             VALUES ${values} ON CONFLICT (trip_id, stop_sequence) DO NOTHING`,
            flat
          );
          stats.stop_times += batch.length;
        }
        console.log('  stop_times:', rows.length);
      }

      // 6. Shapes (hình học tuyến – nếu có file)
      const shapesPath = path.join(feedPath, 'shapes.txt');
      if (fs.existsSync(shapesPath)) {
        const rows = readCSV(shapesPath);
        const BATCH = 1000;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH).filter((r) => r.shape_id && r.shape_pt_lat != null && r.shape_pt_lon != null);
          if (batch.length === 0) continue;
          const values = batch.map((r, idx) => {
            const n = idx * 5;
            return `($${n+1}, $${n+2}::double precision, $${n+3}::double precision, $${n+4}::int, $${n+5})`;
          }).join(', ');
          const flat = batch.flatMap((r) => [
            r.shape_id,
            parseFloat(r.shape_pt_lat),
            parseFloat(r.shape_pt_lon),
            toInt(r.shape_pt_sequence, 0),
            r.shape_dist_traveled === '' || r.shape_dist_traveled == null ? null : parseFloat(r.shape_dist_traveled),
          ]);
          await client.query(
            `INSERT INTO gtfs.shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled)
             VALUES ${values} ON CONFLICT (shape_id, shape_pt_sequence) DO NOTHING`,
            flat
          );
          stats.shapes += batch.length;
        }
        if (rows.length) console.log('  shapes:', rows.length);
      }

      // 7. Transfers (chuyển tuyến – nếu có file)
      const transfersPath = path.join(feedPath, 'transfers.txt');
      if (fs.existsSync(transfersPath)) {
        const rows = readCSV(transfersPath);
        for (const r of rows) {
          if (!r.from_stop_id || !r.to_stop_id) continue;
          await client.query(
            `INSERT INTO gtfs.transfers (from_stop_id, to_stop_id, transfer_type, min_transfer_time)
             VALUES ($1, $2, $3, $4) ON CONFLICT (from_stop_id, to_stop_id) DO UPDATE SET
             transfer_type = EXCLUDED.transfer_type, min_transfer_time = EXCLUDED.min_transfer_time`,
            [
              r.from_stop_id,
              r.to_stop_id,
              toInt(r.transfer_type, 0),
              (r.min_transfer_time !== '' && r.min_transfer_time != null) ? toInt(r.min_transfer_time, 120) : null,
            ]
          );
          stats.transfers++;
        }
        if (rows.length) console.log('  transfers:', rows.length);
      }
    }

    console.log('\nImport xong. Tổng:', stats);
    console.log('Bước tiếp theo: chạy post-import.sql để tạo bảng gộp bến, edges và views.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
