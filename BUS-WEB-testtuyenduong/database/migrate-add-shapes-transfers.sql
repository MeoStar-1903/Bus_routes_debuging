-- Chạy file này nếu database đã tạo từ schema cũ (chưa có shapes, transfers).
-- Sau đó chạy lại post-import hoặc run-post-import.js để tạo transfers mặc định (nếu chưa có transfers.txt).

SET search_path TO gtfs, public;

-- Bảng shapes (hình học tuyến)
CREATE TABLE IF NOT EXISTS gtfs.shapes (
    shape_id            VARCHAR(64) NOT NULL,
    shape_pt_lat        DOUBLE PRECISION NOT NULL,
    shape_pt_lon        DOUBLE PRECISION NOT NULL,
    shape_pt_sequence   INTEGER NOT NULL,
    shape_dist_traveled DOUBLE PRECISION,
    PRIMARY KEY (shape_id, shape_pt_sequence)
);

-- Bảng transfers (chuyển tuyến)
CREATE TABLE IF NOT EXISTS gtfs.transfers (
    from_stop_id      VARCHAR(64) NOT NULL REFERENCES gtfs.stops(stop_id) ON UPDATE CASCADE,
    to_stop_id        VARCHAR(64) NOT NULL REFERENCES gtfs.stops(stop_id) ON UPDATE CASCADE,
    transfer_type     SMALLINT NOT NULL DEFAULT 0,
    min_transfer_time INTEGER,
    PRIMARY KEY (from_stop_id, to_stop_id)
);

CREATE INDEX IF NOT EXISTS idx_shapes_shape_id ON gtfs.shapes(shape_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON gtfs.transfers(from_stop_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON gtfs.transfers(to_stop_id);

SET search_path TO public;
