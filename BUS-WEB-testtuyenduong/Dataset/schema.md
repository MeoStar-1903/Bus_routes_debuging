# Bus Routes DB – README

## 1. Mục tiêu

Database PostgreSQL dùng dữ liệu GTFS (Hà Nội) để:

- Lưu tuyến, bến, lịch trình xe buýt.  
- Cung cấp cấu trúc dữ liệu ổn định (schema + views) cho backend/frontend tự triển khai thuật toán tìm đường. [web:27][web:41]

Không cần PostGIS hay pgRouting.

---

## 2. Yêu cầu

- PostgreSQL 14+ (khuyến nghị 15/16/18).  
- Quyền tạo schema, function, view.  

---

## 3. Thiết lập schema

### 3.1. Tạo schema `gtfs`

```sql
CREATE SCHEMA IF NOT EXISTS gtfs;
SET search_path TO gtfs;

### 3.2. Bảng GTFS chính
```sql
-- routes
DROP TABLE IF EXISTS routes CASCADE;
CREATE TABLE routes (
    route_id         VARCHAR(64) PRIMARY KEY,
    agency_id        VARCHAR(64),
    route_short_name VARCHAR(64),
    route_long_name  VARCHAR(255),
    route_desc       VARCHAR(255),
    route_type       INTEGER NOT NULL,
    route_url        VARCHAR(255),
    route_color      VARCHAR(6),
    route_text_color VARCHAR(6)
);

-- stops
DROP TABLE IF EXISTS stops CASCADE;
CREATE TABLE stops (
    stop_id         VARCHAR(64) PRIMARY KEY,
    stop_code       VARCHAR(64),
    stop_name       VARCHAR(255) NOT NULL,
    stop_desc       VARCHAR(255),
    stop_lat        DOUBLE PRECISION NOT NULL,
    stop_lon        DOUBLE PRECISION NOT NULL,
    zone_id         VARCHAR(64),
    stop_url        VARCHAR(255),
    location_type   SMALLINT,
    parent_station  VARCHAR(64)
);

-- trips
DROP TABLE IF EXISTS trips CASCADE;
CREATE TABLE trips (
    trip_id       VARCHAR(64) PRIMARY KEY,
    route_id      VARCHAR(64) NOT NULL,
    service_id    VARCHAR(64) NOT NULL,
    trip_headsign VARCHAR(255),
    direction_id  SMALLINT,
    block_id      VARCHAR(64),
    shape_id      VARCHAR(64),

    CONSTRAINT fk_trips_route
        FOREIGN KEY (route_id) REFERENCES routes(route_id)
        ON UPDATE CASCADE
);

-- stop_times
DROP TABLE IF EXISTS stop_times CASCADE;
CREATE TABLE stop_times (
    trip_id             VARCHAR(64) NOT NULL,
    stop_sequence       INTEGER NOT NULL,
    arrival_time        CHAR(8),
    departure_time      CHAR(8),
    stop_id             VARCHAR(64) NOT NULL,
    stop_headsign       VARCHAR(255),
    pickup_type         SMALLINT,
    drop_off_type       SMALLINT,
    shape_dist_traveled DOUBLE PRECISION,

    CONSTRAINT pk_stop_times
        PRIMARY KEY (trip_id, stop_sequence),

    CONSTRAINT fk_stop_times_trip
        FOREIGN KEY (trip_id) REFERENCES trips(trip_id)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_stop_times_stop
        FOREIGN KEY (stop_id) REFERENCES stops(stop_id)
        ON UPDATE CASCADE
);
### 4. Import dữ liệu GTFS
Giả sử có:

routes.txt

stops.txt

trips.txt

stop_times.txt

Đường dẫn /path/... chỉnh theo từng máy. [file:1][file:2][file:3][file:4]

### 4.1. routes
```sql
CREATE TEMP TABLE tmp_routes (LIKE gtfs.routes);

COPY tmp_routes (
    route_id,
    agency_id,
    route_short_name,
    route_long_name,
    route_desc,
    route_type,
    route_url,
    route_color,
    route_text_color
)
FROM '/path/routes.txt' CSV HEADER;

INSERT INTO gtfs.routes AS r (
    route_id,
    agency_id,
    route_short_name,
    route_long_name,
    route_desc,
    route_type,
    route_url,
    route_color,
    route_text_color
)
SELECT
    route_id,
    agency_id,
    route_short_name,
    route_long_name,
    route_desc,
    route_type,
    route_url,
    route_color,
    route_text_color
FROM tmp_routes
ON CONFLICT (route_id) DO NOTHING;
### 4.2. stops
```sql
CREATE TEMP TABLE tmp_stops (LIKE gtfs.stops);

COPY tmp_stops (
    stop_id,
    stop_code,
    stop_name,
    stop_desc,
    stop_lat,
    stop_lon,
    zone_id,
    location_type,
    parent_station
)
FROM '/path/stops.txt' CSV HEADER;

INSERT INTO gtfs.stops AS s (
    stop_id,
    stop_code,
    stop_name,
    stop_desc,
    stop_lat,
    stop_lon,
    zone_id,
    stop_url,
    location_type,
    parent_station
)
SELECT
    stop_id,
    stop_code,
    stop_name,
    stop_desc,
    stop_lat,
    stop_lon,
    zone_id,
    NULL AS stop_url,
    location_type,
    parent_station
FROM tmp_stops
ON CONFLICT (stop_id) DO NOTHING;
### 4.3. trips
```sql
CREATE TEMP TABLE tmp_trips (LIKE gtfs.trips);

COPY tmp_trips (
    route_id,
    service_id,
    trip_id,
    trip_headsign,
    direction_id,
    block_id,
    shape_id
)
FROM '/path/trips.txt' CSV HEADER;

INSERT INTO gtfs.trips AS t (
    trip_id,
    route_id,
    service_id,
    trip_headsign,
    direction_id,
    block_id,
    shape_id
)
SELECT
    trip_id,
    route_id,
    service_id,
    trip_headsign,
    direction_id,
    block_id,
    shape_id
FROM tmp_trips
ON CONFLICT (trip_id) DO NOTHING;
### 4.4. stop_times
```sql
CREATE TEMP TABLE tmp_stop_times (LIKE gtfs.stop_times);

COPY tmp_stop_times (
    trip_id,
    arrival_time,
    departure_time,
    stop_id,
    stop_sequence,
    stop_headsign,
    pickup_type,
    drop_off_type,
    shape_dist_traveled
)
FROM '/path/stop_times.txt' CSV HEADER;

INSERT INTO gtfs.stop_times AS st (
    trip_id,
    stop_sequence,
    arrival_time,
    departure_time,
    stop_id,
    stop_headsign,
    pickup_type,
    drop_off_type,
    shape_dist_traveled
)
SELECT
    trip_id,
    stop_sequence,
    arrival_time,
    departure_time,
    stop_id,
    stop_headsign,
    pickup_type,
    drop_off_type,
    shape_dist_traveled
FROM tmp_stop_times
ON CONFLICT (trip_id, stop_sequence) DO NOTHING;
Nếu có nhiều dataset (AM, PM, v.v.), lặp lại các bước trên; khóa chính + ON CONFLICT DO NOTHING sẽ tránh trùng. [web:16][web:21]

### 5. Hàm tiện ích
### 5.1. Haversine (m)
```sql
CREATE OR REPLACE FUNCTION gtfs.haversine_m(
    lat1 double precision, lon1 double precision,
    lat2 double precision, lon2 double precision
)
RETURNS double precision
LANGUAGE sql
AS $$
    SELECT 2 * 6371000 * ASIN(
        SQRT(
            POWER(SIN(RADIANS(lat2 - lat1) / 2), 2) +
            COS(RADIANS(lat1)) * COS(RADIANS(lat2)) *
            POWER(SIN(RADIANS(lon2 - lon1) / 2), 2)
        )
    );
$$;
### 5.2. time_to_seconds (tuỳ backend dùng)
```sql
CREATE OR REPLACE FUNCTION gtfs.time_to_seconds(t char(8))
RETURNS integer
LANGUAGE sql
AS $$
    SELECT
        COALESCE(substring(t from 1 for 2)::int, 0) * 3600 +
        COALESCE(substring(t from 4 for 2)::int, 0) * 60 +
        COALESCE(substring(t from 7 for 2)::int, 0);
$$;
### 6. Gộp bến & stop_times_merged
### 6.1. Map gộp bến (bán kính 20 m – có thể chỉnh)
```sql
DROP TABLE IF EXISTS gtfs.stop_merge_map;

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
    JOIN gtfs.stops s2
      ON gtfs.haversine_m(
            s1.stop_lat, s1.stop_lon,
            s2.stop_lat, s2.stop_lon
         ) <= 20
    GROUP BY s1.stop_id
)
SELECT DISTINCT stop_id, merged_stop_id
FROM pairs;
### 6.2. stops_merged
```sql
DROP TABLE IF EXISTS gtfs.stops_merged;

CREATE TABLE gtfs.stops_merged AS
SELECT
    m.merged_stop_id AS stop_id,
    MAX(s.stop_name) AS stop_name,
    AVG(s.stop_lat)  AS stop_lat,
    AVG(s.stop_lon)  AS stop_lon
FROM gtfs.stop_merge_map m
JOIN gtfs.stops s
  ON s.stop_id = m.stop_id
GROUP BY m.merged_stop_id;
### 6.3. stop_times_merged
```sql
DROP TABLE IF EXISTS gtfs.stop_times_merged;

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
LEFT JOIN gtfs.stop_merge_map m
  ON st.stop_id = m.stop_id;
### 7. Bảng edges (đồ thị cho backend)
Backend có thể dùng edges để tự triển khai Dijkstra/A* trong code hoặc bằng extension khác. [web:41][web:66]

```sql
DROP TABLE IF EXISTS gtfs.edges;

CREATE TABLE gtfs.edges AS
SELECT
    st1.trip_id,
    st1.stop_id AS from_stop,
    st2.stop_id AS to_stop,
    st1.stop_sequence AS from_seq,
    st2.stop_sequence AS to_seq,
    GREATEST(
        1,
        gtfs.time_to_seconds(st2.arrival_time) - gtfs.time_to_seconds(st1.departure_time)
    ) AS travel_cost
FROM gtfs.stop_times_merged st1
JOIN gtfs.stop_times_merged st2
  ON st1.trip_id = st2.trip_id
 AND st2.stop_sequence = st1.stop_sequence + 1;
### 8. Index & view cho team khác
```sql
-- Index
CREATE INDEX IF NOT EXISTS idx_trips_route_id          ON gtfs.trips(route_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip_id      ON gtfs.stop_times(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_stop_id      ON gtfs.stop_times(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_merged_trip  ON gtfs.stop_times_merged(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_merged_stop  ON gtfs.stop_times_merged(stop_id);
CREATE INDEX IF NOT EXISTS idx_edges_from_stop         ON gtfs.edges(from_stop);
CREATE INDEX IF NOT EXISTS idx_edges_to_stop           ON gtfs.edges(to_stop);

-- View danh sách bến (cho autocomplete)
CREATE OR REPLACE VIEW gtfs.v_stops AS
SELECT stop_id, stop_name, stop_lat, stop_lon
FROM gtfs.stops_merged;
9. Cách dùng mẫu cho backend/frontend
Tìm bến theo tên:

```sql
SELECT stop_id, stop_name, stop_lat, stop_lon
FROM gtfs.v_stops
WHERE stop_name ILIKE '%giáp bát%';
Lấy dữ liệu đồ thị để tính đường đi trong code:

```sql
SELECT from_stop, to_stop, travel_cost
FROM gtfs.edges;
Lấy danh sách bến trên một tuyến:

```sql
SELECT DISTINCT s.stop_id, s.stop_name
FROM gtfs.routes r
JOIN gtfs.trips t
  ON t.route_id = r.route_id
JOIN gtfs.stop_times_merged stm
  ON stm.trip_id = t.trip_id
JOIN gtfs.stops_merged s
  ON s.stop_id = stm.stop_id
WHERE r.route_id = 'ROUTE_ID';

