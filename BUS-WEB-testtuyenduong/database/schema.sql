-- ============================================================
-- BUS ROUTE FINDING - SCHEMA DATABASE (PostgreSQL)
-- Dùng dữ liệu GTFS Hà Nội, thiết kế gọn, dễ dùng, tối ưu cho bản đồ
-- ============================================================

-- Chạy với user có quyền tạo schema (ví dụ: psql -U postgres -d your_db -f schema.sql)

-- 1. Schema GTFS
CREATE SCHEMA IF NOT EXISTS gtfs;
SET search_path TO gtfs, public;

-- 2. Bảng calendar (dịch vụ theo ngày) - từ GTFS
DROP TABLE IF EXISTS gtfs.calendar CASCADE;
CREATE TABLE gtfs.calendar (
    service_id   VARCHAR(64) PRIMARY KEY,
    monday       SMALLINT NOT NULL DEFAULT 0,
    tuesday      SMALLINT NOT NULL DEFAULT 0,
    wednesday    SMALLINT NOT NULL DEFAULT 0,
    thursday     SMALLINT NOT NULL DEFAULT 0,
    friday       SMALLINT NOT NULL DEFAULT 0,
    saturday     SMALLINT NOT NULL DEFAULT 0,
    sunday       SMALLINT NOT NULL DEFAULT 0,
    start_date   DATE,
    end_date     DATE
);

-- 3. Bảng routes (tuyến xe)
DROP TABLE IF EXISTS gtfs.routes CASCADE;
CREATE TABLE gtfs.routes (
    route_id         VARCHAR(64) PRIMARY KEY,
    agency_id        VARCHAR(64),
    route_short_name VARCHAR(64),
    route_long_name  VARCHAR(255),
    route_desc       VARCHAR(255),
    route_type       INTEGER NOT NULL DEFAULT 3,
    route_url        VARCHAR(255),
    route_color      VARCHAR(6),
    route_text_color VARCHAR(6)
);

-- 4. Bảng stops (bến xe) - tọa độ WGS84 cho bản đồ
DROP TABLE IF EXISTS gtfs.stops CASCADE;
CREATE TABLE gtfs.stops (
    stop_id         VARCHAR(64) PRIMARY KEY,
    stop_code       VARCHAR(64),
    stop_name       VARCHAR(255) NOT NULL,
    stop_desc       VARCHAR(255),
    stop_lat        DOUBLE PRECISION NOT NULL,
    stop_lon        DOUBLE PRECISION NOT NULL,
    zone_id         VARCHAR(64),
    stop_url        VARCHAR(255),
    location_type   SMALLINT DEFAULT 0,
    parent_station  VARCHAR(64)
);

-- Ràng buộc tọa độ Hà Nội (để bến khớp bản đồ)
ALTER TABLE gtfs.stops ADD CONSTRAINT chk_stops_lat_lon
  CHECK (stop_lat >= 20.5 AND stop_lat <= 21.5 AND stop_lon >= 105.3 AND stop_lon <= 106.2);

-- 5. Bảng trips (chuyến đi theo tuyến)
DROP TABLE IF EXISTS gtfs.trips CASCADE;
CREATE TABLE gtfs.trips (
    trip_id       VARCHAR(64) PRIMARY KEY,
    route_id      VARCHAR(64) NOT NULL REFERENCES gtfs.routes(route_id) ON UPDATE CASCADE,
    service_id    VARCHAR(64) NOT NULL,
    trip_headsign VARCHAR(255),
    direction_id  SMALLINT,
    block_id      VARCHAR(64),
    shape_id      VARCHAR(64)
);

-- 6. Bảng stop_times (lịch qua bến của từng chuyến)
DROP TABLE IF EXISTS gtfs.stop_times CASCADE;
CREATE TABLE gtfs.stop_times (
    trip_id             VARCHAR(64) NOT NULL REFERENCES gtfs.trips(trip_id) ON UPDATE CASCADE ON DELETE CASCADE,
    stop_sequence       INTEGER NOT NULL,
    arrival_time        CHAR(8),
    departure_time      CHAR(8),
    stop_id             VARCHAR(64) NOT NULL REFERENCES gtfs.stops(stop_id) ON UPDATE CASCADE,
    stop_headsign       VARCHAR(255),
    pickup_type         SMALLINT DEFAULT 0,
    drop_off_type       SMALLINT DEFAULT 0,
    shape_dist_traveled DOUBLE PRECISION,
    PRIMARY KEY (trip_id, stop_sequence)
);

-- 6b. Bảng shapes (hình học tuyến – để vẽ đúng quỹ đạo xe trên bản đồ, không bị thẳng nối trạm)
DROP TABLE IF EXISTS gtfs.shapes CASCADE;
CREATE TABLE gtfs.shapes (
    shape_id            VARCHAR(64) NOT NULL,
    shape_pt_lat        DOUBLE PRECISION NOT NULL,
    shape_pt_lon        DOUBLE PRECISION NOT NULL,
    shape_pt_sequence   INTEGER NOT NULL,
    shape_dist_traveled DOUBLE PRECISION,
    PRIMARY KEY (shape_id, shape_pt_sequence)
);

-- 6c. Bảng transfers (chuyển tuyến – trạm nào nối trạm nào, thời gian đi bộ tối thiểu)
DROP TABLE IF EXISTS gtfs.transfers CASCADE;
CREATE TABLE gtfs.transfers (
    from_stop_id      VARCHAR(64) NOT NULL REFERENCES gtfs.stops(stop_id) ON UPDATE CASCADE,
    to_stop_id        VARCHAR(64) NOT NULL REFERENCES gtfs.stops(stop_id) ON UPDATE CASCADE,
    transfer_type     SMALLINT NOT NULL DEFAULT 0,
    min_transfer_time INTEGER,
    PRIMARY KEY (from_stop_id, to_stop_id)
);
-- transfer_type: 0=recommended, 1=timed, 2=min time (dùng min_transfer_time), 3=not possible

-- 7. Bảng tên hiển thị bến (tùy chọn - map tên thật địa danh để khớp bản đồ)
DROP TABLE IF EXISTS gtfs.stop_display_names CASCADE;
CREATE TABLE gtfs.stop_display_names (
    stop_id       VARCHAR(64) PRIMARY KEY REFERENCES gtfs.stops(stop_id) ON UPDATE CASCADE ON DELETE CASCADE,
    display_name  VARCHAR(255) NOT NULL
);

-- 8. Hàm tiện ích
-- Khoảng cách Haversine (mét)
CREATE OR REPLACE FUNCTION gtfs.haversine_m(
    lat1 double precision, lon1 double precision,
    lat2 double precision, lon2 double precision
)
RETURNS double precision
LANGUAGE sql IMMUTABLE
AS $$
    SELECT 2 * 6371000 * ASIN(
        SQRT(
            POWER(SIN(RADIANS(lat2 - lat1) / 2), 2) +
            COS(RADIANS(lat1)) * COS(RADIANS(lat2)) *
            POWER(SIN(RADIANS(lon2 - lon1) / 2), 2)
        )
    );
$$;

-- Chuyển thời gian "HH:MM:SS" thành giây
CREATE OR REPLACE FUNCTION gtfs.time_to_seconds(t char(8))
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT
        COALESCE(SUBSTRING(t FROM 1 FOR 2)::int, 0) * 3600 +
        COALESCE(SUBSTRING(t FROM 4 FOR 2)::int, 0) * 60 +
        COALESCE(SUBSTRING(t FROM 7 FOR 2)::int, 0);
$$;

-- 9. Schema public: bảng ứng dụng (users, ratings, history)
SET search_path TO public;

DROP TABLE IF EXISTS route_search_history CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE route_search_history (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin_stop_id       VARCHAR(64),
    destination_stop_id VARCHAR(64),
    origin_name          VARCHAR(255),
    destination_name     VARCHAR(255),
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ratings (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route_id   VARCHAR(64) NOT NULL,
    rating     SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment    TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index cơ bản cho bảng app
CREATE INDEX IF NOT EXISTS idx_route_search_history_user ON route_search_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_route ON ratings(route_id);

-- Trả lại search_path
SET search_path TO public, gtfs;
