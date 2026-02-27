// [ADDED] Controller POST/GET ratings theo report (FR6)
const pool = require('../db');

async function submitRating(req, res) {
  const { routeId, rating, comment } = req.body || {};
  if (!routeId || rating == null) {
    return res.status(400).json({ error: 'routeId and rating (1-5) are required' });
  }
  const r = parseInt(rating, 10);
  if (r < 1 || r > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO ratings (user_id, route_id, rating, comment)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, String(routeId), r, comment || null]
    );
    return res.status(201).json({ ratingId: String(result.rows[0].id) });
  } catch (err) {
    console.error('submitRating error', err);
    return res.status(500).json({ error: 'Failed to submit rating' });
  }
}

async function getRatings(req, res) {
  const routeId = req.params.routeId;
  if (!routeId) return res.status(400).json({ error: 'routeId required' });
  try {
    const avgResult = await pool.query(
      `SELECT AVG(rating)::numeric(3,2) AS avg, COUNT(*) AS count
       FROM ratings WHERE route_id = $1`,
      [routeId]
    );
    const recentResult = await pool.query(
      `SELECT rating, comment, created_at
       FROM ratings WHERE route_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [routeId]
    );
    const row = avgResult.rows[0];
    return res.status(200).json({
      avg: row && row.avg != null ? parseFloat(row.avg) : null,
      count: row ? parseInt(row.count, 10) : 0,
      recent: recentResult.rows.map((r) => ({
        rating: r.rating,
        comment: r.comment,
        timestamp: r.created_at,
      })),
    });
  } catch (err) {
    console.error('getRatings error', err);
    return res.status(500).json({ error: 'Failed to get ratings' });
  }
}

module.exports = { submitRating, getRatings };
