/**
 * Map Logic Layer – khởi tạo bản đồ, vẽ trạm, vẽ tuyến theo đường xá (OSRM), snap điểm.
 * Phụ thuộc: Leaflet (L), BusAPI (sau khi load api.js).
 */
(function (global) {
  'use strict';

  const L = global.L;
  const BusAPI = global.BusAPI;
  if (!L) return;

  const DEFAULT_CENTER = [21.0278, 105.8342];
  const DEFAULT_ZOOM = 13;

  /**
   * Tạo bản đồ Leaflet cơ bản (tile OSM, zoom control).
   * @param {string} containerId - id thẻ div
   * @param {Object} opts - { center, zoom }
   * @returns {L.Map}
   */
  function initMap(containerId, opts = {}) {
    const map = L.map(containerId, { zoomControl: false })
      .setView(opts.center || DEFAULT_CENTER, opts.zoom != null ? opts.zoom : DEFAULT_ZOOM);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    return map;
  }

  /**
   * Lấy danh sách tọa độ theo thứ tự từ route (để gửi OSRM).
   * Loại bỏ điểm trùng giữa hai step liên tiếp (điểm chuyển tuyến).
   */
  function getOrderedCoordinatesFromRoute(route) {
    if (!route || !route.steps || !route.steps.length) return [];
    const out = [];
    let prev = null;
    for (const step of route.steps) {
      const coords = step.coordinates || [];
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const pt = Array.isArray(c) ? [Number(c[0]), Number(c[1])] : [c.lat, c.lon];
        if (prev && pt[0] === prev[0] && pt[1] === prev[1]) continue;
        out.push(pt);
        prev = pt;
      }
    }
    return out;
  }

  /**
   * Vẽ tuyến bám đường xá qua OSRM. Nếu OSRM lỗi hoặc không có geometry thì vẽ đường thẳng.
   * @param {Object} route - đối tượng route từ API (có steps[].coordinates)
   * @param {L.Map} map
   * @param {L.LayerGroup} layerGroup - layer chứa polyline (sẽ xóa cũ rồi thêm mới)
   * @param {Object} style - { color, weight }
   * @returns {Promise<Array<L.LatLng>>} bounds để fitBounds
   */
  async function drawRouteWithRoadNetwork(route, map, layerGroup, style = { color: 'blue', weight: 5 }) {
    layerGroup.clearLayers();
    const points = getOrderedCoordinatesFromRoute(route);
    if (points.length < 2) return [];

    let latlngs = points;
    if (BusAPI && typeof BusAPI.getOSRMRoute === 'function') {
      try {
        const roadCoords = await BusAPI.getOSRMRoute(points);
        if (roadCoords && roadCoords.length >= 2) latlngs = roadCoords;
      } catch (e) {
        console.warn('OSRM fallback to straight line', e);
      }
    }
    const leafletLatLngs = latlngs.map((p) => L.latLng(p[0], p[1]));
    L.polyline(leafletLatLngs, style).addTo(layerGroup);
    return leafletLatLngs;
  }

  /**
   * Thêm marker trạm xe buýt lên bản đồ (circleMarker nhỏ, popup tên trạm).
   * @param {L.Map} map
   * @param {Array<{stopId, name, lat, lon}>} stops
   * @param {L.LayerGroup} layerGroup - nếu có thì thêm vào layer để dễ xóa/ẩn
   */
  function addStopMarkers(map, stops, layerGroup) {
    if (!stops || !stops.length) return;
    const group = layerGroup || L.layerGroup().addTo(map);
    stops.forEach((s) => {
      const m = L.circleMarker([s.lat, s.lon], {
        radius: 6,
        fillColor: '#0066cc',
        color: '#fff',
        weight: 1,
        fillOpacity: 0.8,
      }).bindPopup(`<b>${(s.name || s.stopId || '').replace(/</g, '&lt;')}</b>`);
      group.addLayer(m);
    });
    return group;
  }

  /**
   * Snap marker về đúng tọa độ trạm (để đường nối không bị lệch).
   * @param {L.Marker} marker
   * @param {{ lat: number, lon: number }} stop
   */
  function snapMarkerToStop(marker, stop) {
    if (!marker || !stop) return;
    marker.setLatLng([stop.lat, stop.lon]);
  }

  /**
   * Load trạm trong viewport và vẽ lên bản đồ.
   * @param {L.Map} map
   * @param {L.LayerGroup} stopsLayer - layer chứa stop markers (sẽ clear rồi thêm mới)
   */
  async function loadAndShowStopsInView(map, stopsLayer) {
    if (!BusAPI || !BusAPI.getStops) return;
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    try {
      const stops = await BusAPI.getStops({
        minLat: sw.lat,
        minLon: sw.lng,
        maxLat: ne.lat,
        maxLon: ne.lng,
        limit: 2000,
      });
      if (stopsLayer) stopsLayer.clearLayers();
      addStopMarkers(map, stops, stopsLayer || L.layerGroup().addTo(map));
    } catch (e) {
      console.warn('Load stops in view failed', e);
    }
  }

  global.BusMapService = {
    initMap,
    getOrderedCoordinatesFromRoute,
    drawRouteWithRoadNetwork,
    addStopMarkers,
    snapMarkerToStop,
    loadAndShowStopsInView,
    DEFAULT_CENTER,
    DEFAULT_ZOOM,
  };
})(typeof window !== 'undefined' ? window : this);
