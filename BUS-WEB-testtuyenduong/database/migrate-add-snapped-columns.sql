-- Chạy file này nếu bạn đã chạy post-import.sql trước đó (trước khi có cột snap).
-- Thêm cột tọa độ snap và cập nhật view. Sau đó chạy: node database/snap-stops-to-road.js

SET search_path TO gtfs, public;

ALTER TABLE gtfs.stops_merged ADD COLUMN IF NOT EXISTS stop_lat_snapped DOUBLE PRECISION;
ALTER TABLE gtfs.stops_merged ADD COLUMN IF NOT EXISTS stop_lon_snapped DOUBLE PRECISION;

CREATE OR REPLACE VIEW gtfs.v_stops AS
SELECT
    s.stop_id,
    COALESCE(d.display_name, s.stop_name) AS stop_name,
    COALESCE(s.stop_lat_snapped, s.stop_lat) AS stop_lat,
    COALESCE(s.stop_lon_snapped, s.stop_lon) AS stop_lon
FROM gtfs.stops_merged s
LEFT JOIN gtfs.stop_display_names d ON d.stop_id = s.stop_id;

CREATE OR REPLACE VIEW gtfs.v_route_stops AS
SELECT DISTINCT
    r.route_id,
    r.route_short_name,
    r.route_long_name,
    s.stop_id,
    s.stop_name,
    COALESCE(s.stop_lat_snapped, s.stop_lat) AS stop_lat,
    COALESCE(s.stop_lon_snapped, s.stop_lon) AS stop_lon,
    MIN(st.stop_sequence) AS min_sequence
FROM gtfs.routes r
JOIN gtfs.trips t ON t.route_id = r.route_id
JOIN gtfs.stop_times_merged st ON st.trip_id = t.trip_id
JOIN gtfs.stops_merged s ON s.stop_id = st.stop_id
GROUP BY r.route_id, r.route_short_name, r.route_long_name, s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, s.stop_lat_snapped, s.stop_lon_snapped;

SET search_path TO public;
