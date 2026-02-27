/**
 * API Layer – gọi backend và OSRM.
 * Tách riêng để dễ mock/test và đổi base URL.
 * Sử dụng: window.BusAPI (sau khi load script).
 */
(function (global) {
  'use strict';

  const API_BASE = global.API_BASE || 'http://localhost:3000';
  const OSRM_BASE = 'https://router.project-osrm.org';

  /**
   * Lấy danh sách trạm (có thể lọc theo từ khóa hoặc bbox viewport).
   * @param {Object} opts - { search, limit, minLat, maxLat, minLon, maxLon }
   * @returns {Promise<Array<{stopId, name, lat, lon}>>}
   */
  async function getStops(opts = {}) {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.limit != null) params.set('limit', opts.limit);
    if (opts.minLat != null) params.set('minLat', opts.minLat);
    if (opts.maxLat != null) params.set('maxLat', opts.maxLat);
    if (opts.minLon != null) params.set('minLon', opts.minLon);
    if (opts.maxLon != null) params.set('maxLon', opts.maxLon);
    const q = params.toString();
    const url = `${API_BASE}/api/stops${q ? '?' + q : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to get stops');
    return res.json();
  }

  /**
   * Bến gần nhất theo tọa độ (dùng cho snap điểm A/B).
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<{stopId, name, lat, lon}|null>}
   */
  async function getNearestStop(lat, lon) {
    const res = await fetch(`${API_BASE}/api/stops/nearest?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.stopId ? data : null;
  }

  /**
   * Tìm tuyến xe buýt giữa hai bến (origin/dest = stopId).
   * @param {string} originId
   * @param {string} destId
   * @param {string} mode - 'fastest' | 'fewest_stops'
   * @param {string} [token] - JWT optional
   * @returns {Promise<{routes: Array}>}
   */
  async function searchRoutes(originId, destId, mode = 'fastest', token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const url = `${API_BASE}/api/routes/search?origin=${encodeURIComponent(originId)}&dest=${encodeURIComponent(destId)}&mode=${mode}`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Route search failed');
    return data;
  }

  /**
   * Lấy geometry đường đi theo đường xá (OSRM public).
   * Chia tuyến thành từng đoạn nhỏ, retry + fallback đầu-cuối để hạn chế đứt tuyến.
   */
  const OSRM_MAX_WAYPOINTS = 15;

  async function getOSRMRouteSegment(segmentPoints) {
    if (!segmentPoints || segmentPoints.length < 2) return [];
    const coords = segmentPoints.map((p) => `${p[1]},${p[0]}`).join(';');
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0].geometry || !data.routes[0].geometry.coordinates) {
      return [];
    }
    return data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
  }

  async function getOSRMRoute(points) {
    if (!points || points.length < 2) return points || [];
    if (points.length <= OSRM_MAX_WAYPOINTS) {
      let result = await getOSRMRouteSegment(points);
      if (result.length < 2) {
        await new Promise((r) => setTimeout(r, 300));
        result = await getOSRMRouteSegment(points);
      }
      if (result.length < 2 && points.length > 2) {
        result = await getOSRMRouteSegment([points[0], points[points.length - 1]]);
      }
      return result.length >= 2 ? result : points;
    }
    const merged = [];
    for (let i = 0; i < points.length; i += OSRM_MAX_WAYPOINTS - 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200));
      const chunk = points.slice(i, i + OSRM_MAX_WAYPOINTS);
      let segment = await getOSRMRouteSegment(chunk);
      if (segment.length < 2) {
        await new Promise((r) => setTimeout(r, 300));
        segment = await getOSRMRouteSegment(chunk);
      }
      if (segment.length < 2 && chunk.length > 2) {
        segment = await getOSRMRouteSegment([chunk[0], chunk[chunk.length - 1]]);
      }
      if (segment.length < 2) {
        merged.push(...chunk);
        continue;
      }
      if (merged.length > 0) segment.shift();
      merged.push(...segment);
    }
    return merged.length >= 2 ? merged : points;
  }

  global.BusAPI = {
    getStops,
    getNearestStop,
    searchRoutes,
    getOSRMRoute,
    API_BASE,
  };
})(typeof window !== 'undefined' ? window : this);
