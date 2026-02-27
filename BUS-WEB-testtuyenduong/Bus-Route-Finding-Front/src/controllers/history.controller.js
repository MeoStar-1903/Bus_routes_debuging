// [ADDED] Controller GET /api/history (lịch sử tìm kiếm user) theo report FR7
const pool = require('../db');

async function getHistory(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, origin_stop_id, destination_stop_id, origin_name, destination_name, created_at
       FROM route_search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return res.status(200).json(
      result.rows.map((r) => ({
        id: r.id,
        origin: r.origin_name || r.origin_stop_id,
        destination: r.destination_name || r.destination_stop_id,
        originStopId: r.origin_stop_id,
        destinationStopId: r.destination_stop_id,
        timestamp: r.created_at,
      }))
    );
  } catch (err) {
    console.error('getHistory error', err);
    return res.status(500).json({ error: 'Failed to get history' });
  }
}

module.exports = { getHistory };
