// [ADDED] Controller GET /api/stops (list/tìm bến theo keyword) theo report
const graphService = require('../services/graphService');

function getStops(req, res) {
  try {
    const search = (req.query.search || '').trim();
    const limit = req.query.limit;
    const minLat = req.query.minLat != null ? parseFloat(req.query.minLat) : null;
    const maxLat = req.query.maxLat != null ? parseFloat(req.query.maxLat) : null;
    const minLon = req.query.minLon != null ? parseFloat(req.query.minLon) : null;
    const maxLon = req.query.maxLon != null ? parseFloat(req.query.maxLon) : null;
    const opts = {};
    if (limit != null) opts.limit = limit;
    if (minLat != null && maxLat != null && minLon != null && maxLon != null && !isNaN(minLat) && !isNaN(maxLat) && !isNaN(minLon) && !isNaN(maxLon)) {
      opts.minLat = minLat;
      opts.maxLat = maxLat;
      opts.minLon = minLon;
      opts.maxLon = maxLon;
    }
    const list = graphService.getStops(search, opts);
    return res.status(200).json(
      list.map((s) => ({
        stopId: s.stop_id,
        name: s.stop_name,
        lat: s.stop_lat,
        lon: s.stop_lon,
      }))
    );
  } catch (err) {
    console.error('getStops error', err);
    return res.status(500).json({ error: 'Failed to get stops' });
  }
}

// [ADDED] Trả về bến gần nhất theo tọa độ (cho chọn điểm trên bản đồ)
function getNearestStop(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'Query lat and lon are required' });
  }
  try {
    const stop = graphService.getNearestStop(lat, lon);
    if (!stop) return res.status(404).json({ error: 'No stops loaded' });
    return res.status(200).json({
      stopId: stop.stop_id,
      name: stop.stop_name,
      lat: stop.stop_lat,
      lon: stop.stop_lon,
    });
  } catch (err) {
    console.error('getNearestStop error', err);
    return res.status(500).json({ error: 'Failed to get nearest stop' });
  }
}

module.exports = { getStops, getNearestStop };
