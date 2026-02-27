// [ADDED] Gộp tất cả API theo report: auth, stops, routes/search, ratings, history
const express = require('express');
const authRoutes = require('./auth.routes');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const stopsController = require('../controllers/stops.controller');
const routesSearchController = require('../controllers/routesSearch.controller');
const ratingsController = require('../controllers/ratings.controller');
const historyController = require('../controllers/history.controller');

const router = express.Router();

router.use('/auth', authRoutes);

router.get('/stops', stopsController.getStops);
router.get('/stops/nearest', stopsController.getNearestStop);

router.get('/routes/search', optionalAuth, routesSearchController.searchRoutes);

router.post('/ratings', authMiddleware, ratingsController.submitRating);
router.get('/ratings/:routeId', ratingsController.getRatings);

router.get('/history', authMiddleware, historyController.getHistory);

module.exports = router;
