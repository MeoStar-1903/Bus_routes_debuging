// [ADDED] Controller GET /api/routes/search (tìm đường A-B, Dijkstra/BFS) theo report
const graphService = require('../services/graphService');
const pool = require('../db');
const { authMiddleware } = require('../middleware/auth');

async function searchRoutes(req, res) {
  const origin = (req.query.origin || '').trim();
  const dest = (req.query.dest || '').trim();
  const mode = (req.query.mode || 'fastest').trim(); // fastest | fewest_stops
  if (!origin || !dest) {
    return res.status(400).json({ error: 'Query parameters origin and dest are required' });
  }
  try {
    const graph = graphService.getGraphState();
    if (!graph || !graph.stopMap.has(origin) || !graph.stopMap.has(dest)) {
      return res.status(400).json({ error: 'Invalid origin or destination stop ID' });
    }
    let pathResult;
    if (mode === 'fewest_stops') {
      pathResult = graphService.bfs(origin, dest);
    } else {
      pathResult = graphService.dijkstra(origin, dest, true);
    }
    if (!pathResult) {
      return res.status(200).json({ routes: [] });
    }
    const result = graphService.pathToSteps(pathResult, mode);
    if (!result) return res.status(200).json({ routes: [] });
    const stepsForClient = result.steps.map((s) => ({
      routeId: s.routeId,
      fromStop: s.fromStop,
      toStop: s.toStop,
      stopIds: s.stopIds,
      stopCount: s.stopCount,
      coordinates: (s.stopIds || [])
        .map((id) => graph.stopMap.get(id))
        .filter(Boolean)
        .map((st) => [st.stop_lat, st.stop_lon]),
    }));
    const routePayload = {
      steps: stepsForClient,
      distance: result.distance,
      time: result.time,
      transfers: result.transfers,
      pathStopIds: result.pathStopIds,
    };
    // [ADDED] Lưu lịch sử tìm kiếm nếu có user (auth middleware đã gắn req.user)
    if (req.user) {
      try {
        const originName = graph.stopMap.get(origin)?.stop_name || origin;
        const destName = graph.stopMap.get(dest)?.stop_name || dest;
        await pool.query(
          `INSERT INTO route_search_history (user_id, origin_stop_id, destination_stop_id, origin_name, destination_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.user.id, origin, dest, originName, destName]
        );
      } catch (e) {
        console.error('Save history error', e);
      }
    }
    return res.status(200).json({ routes: [routePayload] });
  } catch (err) {
    console.error('searchRoutes error', err);
    return res.status(500).json({ error: 'Route search failed' });
  }
}

module.exports = { searchRoutes };
