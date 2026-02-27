// [ADDED] Dịch vụ đồ thị: load GTFS từ CSV, Dijkstra/BFS, transfer penalty theo report
const fs = require('fs');
const path = require('path');

const HAVERSINE_RADIUS_M = 20;
const TRANSFER_PENALTY = 300; // giây (5 phút) - [ADDED] penalty khi đổi tuyến

// [ADDED] Haversine distance (mét)
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// [ADDED] Chuyển thời gian "HH:MM:SS" thành giây
function timeToSeconds(t) {
  if (!t || t.length < 8) return 0;
  const parts = t.trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseInt(parts[2], 10) || 0;
  return h * 3600 + m * 60 + s;
}

// [ADDED] Đọc CSV đơn giản (dòng đầu là header)
function readCSV(filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath);
  if (!fs.existsSync(fullPath)) return [];
  const text = fs.readFileSync(fullPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const obj = {};
    headers.forEach((h, j) => (obj[h.trim()] = values[j] != null ? values[j].trim() : ''));
    rows.push(obj);
  }
  return rows;
}

let graphState = null;

// [ADDED] Load đồ thị từ PostgreSQL (gtfs.stops_merged, gtfs.edges) - ưu tiên khi đã import DB
async function loadGraphFromDb(pool) {
  if (!pool) return false;
  try {
      const stopsRes = await pool.query(
        `SELECT stop_id, stop_name,
         COALESCE(stop_lat_snapped, stop_lat) AS stop_lat,
         COALESCE(stop_lon_snapped, stop_lon) AS stop_lon
         FROM gtfs.stops_merged`
      );
      const edgesRes = await pool.query(
        `SELECT from_stop, to_stop, travel_cost, route_id FROM gtfs.edges`
      );
      const mergeMapRes = await pool.query(
        `SELECT stop_id, merged_stop_id FROM gtfs.stop_merge_map`
      );
      const transfersRes = await pool.query(
        `SELECT from_stop_id, to_stop_id, transfer_type, min_transfer_time FROM gtfs.transfers`
      ).catch(() => ({ rows: [] }));
      if (!stopsRes.rows.length) return false;

      const stops = stopsRes.rows.map((r) => ({
        stop_id: r.stop_id,
        stop_name: r.stop_name || r.stop_id,
        stop_lat: parseFloat(r.stop_lat),
        stop_lon: parseFloat(r.stop_lon),
      }));
      const stopMap = new Map(stops.map((s) => [s.stop_id, s]));
      const stopIdToMerged = new Map();
      for (const s of stops) stopIdToMerged.set(s.stop_id, s.stop_id);
      for (const r of mergeMapRes.rows) stopIdToMerged.set(r.stop_id, r.merged_stop_id);

      const adjacency = new Map();
      for (const e of edgesRes.rows) {
        const from = e.from_stop;
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push({
          to: e.to_stop,
          weight: Math.max(1, parseInt(e.travel_cost, 10) || 1),
          routeId: e.route_id || null,
        });
      }
      const transferPenaltySec = Math.max(60, TRANSFER_PENALTY);
      for (const t of transfersRes.rows) {
        if (t.transfer_type === 3) continue;
        const fromM = stopIdToMerged.get(t.from_stop_id) || t.from_stop_id;
        const toM = stopIdToMerged.get(t.to_stop_id) || t.to_stop_id;
        if (!stopMap.has(fromM) || !stopMap.has(toM) || fromM === toM) continue;
        const w = t.min_transfer_time != null ? Math.max(60, parseInt(t.min_transfer_time, 10)) : transferPenaltySec;
        if (!adjacency.has(fromM)) adjacency.set(fromM, []);
        adjacency.get(fromM).push({ to: toM, weight: w, routeId: null });
      }

      graphState = { stops, stopMap, adjacency, stopIdToMerged };
      const edgeCount = edgesRes.rows.length + transfersRes.rows.length;
      console.log(
        '[Graph] Loaded from DB:',
        stops.length,
        'stops,',
        edgeCount,
        'edges (incl. transfers)'
      );
      return true;
  } catch (err) {
    console.warn('[Graph] DB load failed:', err.message);
    return false;
  }
}

// [ADDED] Trả về thư mục Dataset: hỗ trợ local (../../../Dataset) và deploy/Docker (../../Dataset)
function getDatasetPath() {
  if (process.env.DATASET_PATH) return process.env.DATASET_PATH;
  const inApp = path.join(__dirname, '..', '..', 'Dataset');
  const inParent = path.join(__dirname, '..', '..', '..', 'Dataset');
  if (fs.existsSync(inApp)) return inApp;
  return inParent;
}

// [ADDED] Load và build đồ thị từ CSV (ưu tiên feed am, có thể mở rộng md, pm)
function loadGraphFromCSV() {
  const datasetPath = getDatasetPath();
  const feeds = ['hanoi_gtfs_am', 'hanoi_gtfs_md', 'hanoi_gtfs_pm'];
  const allStops = [];
  const tripToRoute = new Map();
  const stopTimesByTrip = new Map(); // trip_id -> [{ stop_id, stop_sequence, arrival_time, departure_time }]

  for (const feed of feeds) {
    const feedPath = path.join(datasetPath, feed);
    if (!fs.existsSync(feedPath)) continue;

    const stopsPath = path.join(feedPath, 'stops.txt');
    const tripsPath = path.join(feedPath, 'trips.txt');
    const stopTimesPath = path.join(feedPath, 'stop_times.txt');

    if (fs.existsSync(stopsPath)) {
      const rows = readCSV(stopsPath);
      rows.forEach((r) => {
        const lat = parseFloat(r.stop_lat);
        const lon = parseFloat(r.stop_lon);
        if (!isNaN(lat) && !isNaN(lon))
          allStops.push({
            stop_id: r.stop_id,
            stop_name: r.stop_name || r.stop_id,
            stop_lat: lat,
            stop_lon: lon,
          });
      });
    }
    if (fs.existsSync(tripsPath)) {
      const rows = readCSV(tripsPath);
      rows.forEach((r) => {
        if (r.trip_id && r.route_id && !tripToRoute.has(r.trip_id))
          tripToRoute.set(r.trip_id, r.route_id);
      });
    }
    if (fs.existsSync(stopTimesPath)) {
      const rows = readCSV(stopTimesPath);
      rows.forEach((r) => {
        const tripId = r.trip_id;
        if (!tripId) return;
        if (!stopTimesByTrip.has(tripId)) stopTimesByTrip.set(tripId, []);
        stopTimesByTrip.get(tripId).push({
          stop_id: r.stop_id,
          stop_sequence: parseInt(r.stop_sequence, 10) || 0,
          arrival_time: r.arrival_time,
          departure_time: r.departure_time,
        });
      });
    }
  }

  // [ADDED] Gộp bến trong bán kính 20m -> merged_id = min(stop_id) trong cụm
  const stopIdToMerged = new Map();
  const mergedStops = new Map(); // merged_id -> { stop_name, stop_lat, stop_lon }
  for (const s of allStops) {
    let canonical = s.stop_id;
    for (const o of allStops) {
      if (
        haversineM(s.stop_lat, s.stop_lon, o.stop_lat, o.stop_lon) <= HAVERSINE_RADIUS_M &&
        o.stop_id < canonical
      )
        canonical = o.stop_id;
    }
    stopIdToMerged.set(s.stop_id, canonical);
    if (!mergedStops.has(canonical))
      mergedStops.set(canonical, {
        stop_id: canonical,
        stop_name: s.stop_name,
        stop_lat: s.stop_lat,
        stop_lon: s.stop_lon,
      });
  }
  // Cập nhật tên từ bất kỳ stop nào trong cụm
  for (const s of allStops) {
    const mid = stopIdToMerged.get(s.stop_id);
    if (mergedStops.has(mid) && (s.stop_name || '').length > (mergedStops.get(mid).stop_name || '').length)
      mergedStops.get(mid).stop_name = s.stop_name;
  }

  // [ADDED] Xây cạnh: từ stop_times (consecutive stops trong cùng trip) + trips (route_id)
  const adjacency = new Map(); // from_merged -> [{ to, weight, routeId }]
  for (const [tripId, times] of stopTimesByTrip) {
    const routeId = tripToRoute.get(tripId) || tripId;
    times.sort((a, b) => a.stop_sequence - b.stop_sequence);
    for (let i = 0; i < times.length - 1; i++) {
      const fromId = stopIdToMerged.get(times[i].stop_id) || times[i].stop_id;
      const toId = stopIdToMerged.get(times[i + 1].stop_id) || times[i + 1].stop_id;
      if (fromId === toId) continue;
      const cost = Math.max(
        1,
        timeToSeconds(times[i + 1].arrival_time) - timeToSeconds(times[i].departure_time)
      );
      if (!adjacency.has(fromId)) adjacency.set(fromId, []);
      adjacency.get(fromId).push({ to: toId, weight: cost, routeId });
    }
  }

  // [ADDED] Cạnh chuyển tuyến: hai bến merged trong 300m có thể đi bộ chuyển (khi load từ CSV, không có DB transfers)
  const TRANSFER_RADIUS_M = 300;
  const stopsList = Array.from(mergedStops.values());
  let transferEdges = 0;
  const degApprox = 0.005; // ~500m, lọc nhanh trước khi gọi haversine
  for (let i = 0; i < stopsList.length; i++) {
    const a = stopsList[i];
    for (let j = i + 1; j < stopsList.length; j++) {
      const b = stopsList[j];
      if (Math.abs(a.stop_lat - b.stop_lat) > degApprox || Math.abs(a.stop_lon - b.stop_lon) > degApprox) continue;
      if (haversineM(a.stop_lat, a.stop_lon, b.stop_lat, b.stop_lon) > TRANSFER_RADIUS_M) continue;
      const w = Math.max(TRANSFER_PENALTY, Math.round(haversineM(a.stop_lat, a.stop_lon, b.stop_lat, b.stop_lon) / 1.2));
      if (!adjacency.has(a.stop_id)) adjacency.set(a.stop_id, []);
      adjacency.get(a.stop_id).push({ to: b.stop_id, weight: w, routeId: null });
      if (!adjacency.has(b.stop_id)) adjacency.set(b.stop_id, []);
      adjacency.get(b.stop_id).push({ to: a.stop_id, weight: w, routeId: null });
      transferEdges += 2;
    }
  }

  graphState = {
    stops: stopsList,
    stopMap: mergedStops,
    adjacency,
    stopIdToMerged,
  };
  const totalEdges = Array.from(adjacency.values()).reduce((s, arr) => s + arr.length, 0);
  console.log(
    '[ADDED] Graph loaded:',
    stopsList.length,
    'stops,',
    totalEdges,
    'edges (incl. ' + transferEdges + ' transfer)'
  );
  return graphState;
}

// Min-heap cho Dijkstra (tránh sort toàn bộ queue mỗi bước → giảm memory & CPU)
function createMinHeap(compare = (a, b) => a.cost - b.cost) {
  const arr = [];
  return {
    push(x) {
      arr.push(x);
      let i = arr.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (compare(arr[i], arr[p]) >= 0) break;
        [arr[i], arr[p]] = [arr[p], arr[i]];
        i = p;
      }
    },
    pop() {
      if (arr.length === 0) return undefined;
      const top = arr[0];
      const last = arr.pop();
      if (arr.length === 0) return top;
      arr[0] = last;
      let i = 0;
      const n = arr.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let best = i;
        if (l < n && compare(arr[l], arr[best]) < 0) best = l;
        if (r < n && compare(arr[r], arr[best]) < 0) best = r;
        if (best === i) break;
        [arr[i], arr[best]] = [arr[best], arr[i]];
        i = best;
      }
      return top;
    },
    get length() { return arr.length; },
  };
}

// [ADDED] Dijkstra với transfer penalty; dùng min-heap thay vì array+sort
function dijkstra(originId, destId, useTransferPenalty = true) {
  if (!graphState) loadGraphFromCSV();
  const { adjacency } = graphState;
  const dist = new Map();
  const prev = new Map();
  const key = (node, routeId) => (useTransferPenalty ? `${node}|${routeId || ''}` : node);
  dist.set(key(originId, null), 0);
  const queue = createMinHeap((a, b) => a.cost - b.cost);
  queue.push({ cost: 0, node: originId, routeId: null });
  const visited = new Set();

  while (queue.length > 0) {
    const { cost, node, routeId: inRoute } = queue.pop();
    const vk = key(node, inRoute);
    if (visited.has(vk)) continue;
    visited.add(vk);
    if (node === destId) break;
    const edges = adjacency.get(node);
    if (!edges) continue;
    for (const { to, weight, routeId } of edges) {
      const penalty = useTransferPenalty && inRoute != null && inRoute !== routeId ? TRANSFER_PENALTY : 0;
      const newCost = cost + weight + penalty;
      const tk = key(to, routeId);
      if (newCost < (dist.get(tk) ?? Infinity)) {
        dist.set(tk, newCost);
        prev.set(tk, { node, routeId, weight });
        queue.push({ cost: newCost, node: to, routeId });
      }
    }
  }

  // [ADDED] Reconstruct path: tìm cost nhỏ nhất tới dest (với mọi route)
  let bestDestKey = null;
  let bestCost = Infinity;
  for (const [k, d] of dist) {
    if (k.startsWith(destId + '|') || k === destId) {
      if (d < bestCost) {
        bestCost = d;
        bestDestKey = k;
      }
    }
  }
  if (bestDestKey == null || bestCost === Infinity) return null;
  const pathNodes = [];
  let cur = bestDestKey;
  const destNode = cur.split('|')[0];
  const firstPrev = prev.get(cur);
  pathNodes.push({
    node: destNode,
    routeId: firstPrev ? firstPrev.routeId : null,
    weight: firstPrev ? firstPrev.weight : 0,
  });
  cur = firstPrev ? key(firstPrev.node, firstPrev.routeId) : null;
  while (cur && prev.has(cur)) {
    const p = prev.get(cur);
    pathNodes.push({ node: p.node, routeId: p.routeId, weight: p.weight });
    if (p.node === originId) break;
    cur = key(p.node, p.routeId);
  }
  pathNodes.reverse();
  return { path: pathNodes, totalCost: bestCost };
}

// [ADDED] BFS: ít trạm nhất (mỗi cạnh cost = 1)
function bfs(originId, destId) {
  if (!graphState) loadGraphFromCSV();
  const { adjacency } = graphState;
  const dist = new Map();
  const prev = new Map();
  dist.set(originId, 0);
  const queue = [originId];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === destId) break;
    const edges = adjacency.get(node);
    if (!edges) continue;
    for (const { to, routeId } of edges) {
      const newCost = (dist.get(node) ?? 0) + 1;
      if (newCost < (dist.get(to) ?? Infinity)) {
        dist.set(to, newCost);
        prev.set(to, { node, routeId });
        queue.push(to);
      }
    }
  }
  if (dist.get(destId) == null) return null;
  const pathNodes = [];
  let cur = destId;
  while (cur) {
    const p = prev.get(cur);
    if (!p) {
      pathNodes.push({ node: cur, routeId: null });
      break;
    }
    pathNodes.push({ node: p.node, routeId: p.routeId });
    cur = p.node;
    if (cur === originId) break;
  }
  pathNodes.reverse();
  pathNodes.push({ node: destId, routeId: pathNodes[pathNodes.length - 1]?.routeId || null });
  return { path: pathNodes, totalCost: dist.get(destId) };
}

// [ADDED] Nhóm path thành các bước (từng tuyến) và tính tổng thời gian/ khoảng cách
function pathToSteps(pathResult, mode) {
  if (!pathResult || !pathResult.path.length) return null;
  if (!graphState) return null;
  const { stopMap } = graphState;
  const path = pathResult.path;
  const steps = [];
  let currentRoute = null;
  let currentStops = [];

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const routeId = p.routeId || (path[i + 1] && path[i + 1].routeId);
    if (routeId !== currentRoute) {
      if (currentStops.length > 0)
        steps.push({
          routeId: currentRoute,
          fromStop: currentStops[0],
          toStop: currentStops[currentStops.length - 1],
          stopIds: [...currentStops],
          stopCount: currentStops.length,
        });
      currentRoute = routeId;
      currentStops = [p.node];
    } else {
      currentStops.push(p.node);
    }
  }
  if (currentStops.length > 0)
    steps.push({
      routeId: currentRoute,
      fromStop: currentStops[0],
      toStop: currentStops[currentStops.length - 1],
      stopIds: [...currentStops],
      stopCount: currentStops.length,
    });

  const transfers = Math.max(0, steps.length - 1);
  return {
    steps,
    distance: path.length,
    time: mode === 'fewest_stops' ? path.length : pathResult.totalCost,
    transfers,
    pathStopIds: path.map((p) => p.node),
  };
}

// [ADDED] Tìm bến gần nhất theo tọa độ
function getNearestStop(lat, lon) {
  if (!graphState) loadGraphFromCSV();
  const { stops } = graphState;
  let best = null;
  let bestD = Infinity;
  for (const s of stops) {
    const d = haversineM(lat, lon, s.stop_lat, s.stop_lon);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function getStops(search = '', opts = {}) {
  if (!graphState) loadGraphFromCSV();
  let list = graphState.stops;
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(
      (s) =>
        (s.stop_name && s.stop_name.toLowerCase().includes(q)) ||
        (s.stop_id && s.stop_id.toLowerCase().includes(q))
    );
  }
  // Bbox filter for map viewport: minLat, minLon, maxLat, maxLon (optional)
  if (opts.minLat != null && opts.minLon != null && opts.maxLat != null && opts.maxLon != null) {
    list = list.filter(
      (s) =>
        s.stop_lat >= opts.minLat &&
        s.stop_lat <= opts.maxLat &&
        s.stop_lon >= opts.minLon &&
        s.stop_lon <= opts.maxLon
    );
  }
  const limit = opts.limit != null ? Math.min(Number(opts.limit) || 500, 2000) : 100;
  return list.slice(0, limit);
}

function getGraphState() {
  if (!graphState) loadGraphFromCSV();
  return graphState;
}

module.exports = {
  loadGraphFromCSV,
  loadGraphFromDb,
  getGraphState,
  getStops,
  getNearestStop,
  dijkstra,
  bfs,
  pathToSteps,
  haversineM,
};
