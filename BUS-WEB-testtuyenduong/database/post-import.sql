-- ============================================================
-- Chạy SAU KHI import xong dữ liệu GTFS (sau import-gtfs.js)
-- Tạo bảng gộp bến, edges đồ thị, indexes, views cho tìm đường & bản đồ
-- ============================================================

SET search_path TO gtfs, public;

-- 1. Gộp bến gần nhau (bán kính 20m) -> một bến đại diện (merged)
DROP TABLE IF EXISTS gtfs.stop_merge_map CASCADE;
CREATE TABLE gtfs.stop_merge_map AS
WITH pairs AS (
    SELECT
        s1.stop_id AS stop_id,
        MIN(
            CASE
                WHEN s1.stop_id = s2.stop_id THEN s1.stop_id
                WHEN gtfs.haversine_m(
                        s1.stop_lat, s1.stop_lon,
                        s2.stop_lat, s2.stop_lon
                    ) <= 20
                THEN LEAST(s1.stop_id, s2.stop_id)
                ELSE s1.stop_id
            END
        ) AS merged_stop_id
    FROM gtfs.stops s1
    CROSS JOIN gtfs.stops s2
    WHERE gtfs.haversine_m(
            s1.stop_lat, s1.stop_lon,
            s2.stop_lat, s2.stop_lon
         ) <= 20
    GROUP BY s1.stop_id
)
SELECT DISTINCT stop_id, merged_stop_id FROM pairs;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stop_merge_map_stop ON gtfs.stop_merge_map(stop_id);

-- 2. Bảng bến đã gộp (tọa độ trung bình, tên đại diện) - dùng cho API & bản đồ
DROP TABLE IF EXISTS gtfs.stops_merged CASCADE;
CREATE TABLE gtfs.stops_merged AS
SELECT
    m.merged_stop_id AS stop_id,
    MAX(s.stop_name) AS stop_name,
    ROUND(AVG(s.stop_lat)::numeric, 6)::double precision AS stop_lat,
    ROUND(AVG(s.stop_lon)::numeric, 6)::double precision AS stop_lon
FROM gtfs.stop_merge_map m
JOIN gtfs.stops s ON s.stop_id = m.stop_id
GROUP BY m.merged_stop_id;

ALTER TABLE gtfs.stops_merged ADD PRIMARY KEY (stop_id);
-- Cột tọa độ snap lên đường (OSRM nearest) – dùng cho hiển thị bản đồ khớp đường
ALTER TABLE gtfs.stops_merged ADD COLUMN IF NOT EXISTS stop_lat_snapped DOUBLE PRECISION;
ALTER TABLE gtfs.stops_merged ADD COLUMN IF NOT EXISTS stop_lon_snapped DOUBLE PRECISION;

-- 3. stop_times dùng merged stop_id (cho đồ thị thống nhất)
DROP TABLE IF EXISTS gtfs.stop_times_merged CASCADE;
CREATE TABLE gtfs.stop_times_merged AS
SELECT
    st.trip_id,
    st.stop_sequence,
    st.arrival_time,
    st.departure_time,
    COALESCE(m.merged_stop_id, st.stop_id) AS stop_id,
    st.stop_headsign,
    st.pickup_type,
    st.drop_off_type,
    st.shape_dist_traveled
FROM gtfs.stop_times st
LEFT JOIN gtfs.stop_merge_map m ON st.stop_id = m.stop_id;

-- 4. Bảng cạnh đồ thị (from_stop -> to_stop, cost = giây) cho Dijkstra/A*
DROP TABLE IF EXISTS gtfs.edges CASCADE;
CREATE TABLE gtfs.edges AS
SELECT
    st1.trip_id,
    st1.stop_id AS from_stop,
    st2.stop_id AS to_stop,
    t.route_id,
    st1.stop_sequence AS from_seq,
    st2.stop_sequence AS to_seq,
    GREATEST(
        1,
        gtfs.time_to_seconds(st2.arrival_time) - gtfs.time_to_seconds(st1.departure_time)
    ) AS travel_cost
FROM gtfs.stop_times_merged st1
JOIN gtfs.stop_times_merged st2
  ON st1.trip_id = st2.trip_id AND st2.stop_sequence = st1.stop_sequence + 1
JOIN gtfs.trips t ON t.trip_id = st1.trip_id;

-- 4b. Transfers mặc định (chỉ khi chưa có dữ liệu từ transfers.txt): hai bến trong bán kính 300m có thể chuyển tuyến
INSERT INTO gtfs.transfers (from_stop_id, to_stop_id, transfer_type, min_transfer_time)
SELECT s1.stop_id, s2.stop_id, 2, GREATEST(60, (gtfs.haversine_m(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon) / 1.2)::int)
FROM gtfs.stops_merged s1
JOIN gtfs.stops_merged s2 ON s1.stop_id <> s2.stop_id
  AND gtfs.haversine_m(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon) <= 300
WHERE NOT EXISTS (SELECT 1 FROM gtfs.transfers LIMIT 1)
ON CONFLICT (from_stop_id, to_stop_id) DO NOTHING;

-- 5. Index cho truy vấn nhanh
CREATE INDEX IF NOT EXISTS idx_trips_route_id ON gtfs.trips(route_id);
CREATE INDEX IF NOT EXISTS idx_shapes_shape_id ON gtfs.shapes(shape_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON gtfs.transfers(from_stop_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON gtfs.transfers(to_stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip_id ON gtfs.stop_times(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_stop_id ON gtfs.stop_times(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_merged_trip ON gtfs.stop_times_merged(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_merged_stop ON gtfs.stop_times_merged(stop_id);
CREATE INDEX IF NOT EXISTS idx_edges_from_stop ON gtfs.edges(from_stop);
CREATE INDEX IF NOT EXISTS idx_edges_to_stop ON gtfs.edges(to_stop);
CREATE INDEX IF NOT EXISTS idx_edges_route ON gtfs.edges(route_id);

-- 6. View danh sách bến cho autocomplete & bản đồ (ưu tiên tọa độ đã snap lên đường)
CREATE OR REPLACE VIEW gtfs.v_stops AS
SELECT
    s.stop_id,
    COALESCE(d.display_name, s.stop_name) AS stop_name,
    COALESCE(s.stop_lat_snapped, s.stop_lat) AS stop_lat,
    COALESCE(s.stop_lon_snapped, s.stop_lon) AS stop_lon
FROM gtfs.stops_merged s
LEFT JOIN gtfs.stop_display_names d ON d.stop_id = s.stop_id;

-- 7. View tuyến + danh sách bến (theo thứ tự) cho từng route – ưu tiên tọa độ đã snap
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
