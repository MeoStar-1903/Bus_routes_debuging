# Database – Bus Route Finding (Hà Nội)

Database PostgreSQL dùng dữ liệu GTFS từ folder **Dataset** (hanoi_gtfs_am, hanoi_gtfs_md, hanoi_gtfs_pm). Thiết kế gọn, dễ dùng, tối ưu cho tìm đường và hiển thị bản đồ.

## Yêu cầu

- PostgreSQL 14+
- Node.js (để chạy script import)
- File dữ liệu trong `Dataset/hanoi_gtfs_am`, `Dataset/hanoi_gtfs_md`, `Dataset/hanoi_gtfs_pm`

## Các bước build lại database từ đầu

### 1. Tạo database và schema

```bash
# Tạo database (nếu chưa có)
createdb -U postgres bus_db

# Chạy schema (bảng gtfs + bảng app: users, ratings, route_search_history)
psql -U postgres -d bus_db -f database/schema.sql
```

Hoặc dùng tên database trong `.env` (DB_NAME). Đảm bảo file `Bus-Route-Finding-Front/.env` hoặc `.env` ở thư mục gốc có:

```
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=bus_db
DB_PORT=5432
```

### 2. Import dữ liệu GTFS từ Dataset

Từ **thư mục gốc project** (chứa folder `Dataset` và `database`):

```bash
node database/import-gtfs.js
```

Script sẽ:

- Đọc `Dataset/hanoi_gtfs_am`, `hanoi_gtfs_md`, `hanoi_gtfs_pm`
- Import **calendar**, **routes**, **stops**, **trips**, **stop_times**
- Nếu có: **shapes.txt** (hình học tuyến), **transfers.txt** (chuyển tuyến)
- Chỉ thêm bến có tọa độ trong phạm vi Hà Nội (bến khớp bản đồ)
- Dùng `ON CONFLICT DO NOTHING` để gộp 3 feed (AM/MD/PM) không trùng

### 3. Chạy post-import (gộp bến, đồ thị, views)

```bash
node database/run-post-import.js
```

Hoặc bằng psql:

```bash
psql -U postgres -d bus_db -f database/post-import.sql
```

Bước này tạo:

- **stop_merge_map** – map bến gần nhau (≤20m) về một bến đại diện
- **stops_merged** – bảng bến đã gộp (tọa độ trung bình, dùng cho API & bản đồ)
- **stop_times_merged** – lịch qua bến dùng merged stop_id
- **edges** – cạnh đồ thị (from_stop → to_stop, cost giây) cho tìm đường
- **transfers mặc định** – nếu chưa có `transfers.txt`: hai bến trong 300m có thể chuyển tuyến (min_transfer_time theo khoảng cách đi bộ)
- Index và **views**: `v_stops`, `v_route_stops`

## Cấu trúc chính

| Thành phần | Mô tả |
|------------|--------|
| **gtfs.routes** | Tuyến xe (route_id, route_short_name, route_long_name) |
| **gtfs.stops** | Bến gốc từ GTFS (tọa độ WGS84, ràng buộc trong vùng Hà Nội) |
| **gtfs.stops_merged** | Bến đã gộp (≤20m) – dùng cho API và bản đồ |
| **gtfs.stop_display_names** | Tên hiển thị thay thế (tùy chọn, để map tên địa danh thật) |
| **gtfs.shapes** | Hình học tuyến (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence) – vẽ đúng quỹ đạo trên bản đồ |
| **gtfs.transfers** | Chuyển tuyến (from_stop_id, to_stop_id, transfer_type, min_transfer_time) – dùng cho thuật toán tìm đường |
| **gtfs.trips** | Chuyến đi theo tuyến (có shape_id tham chiếu shapes) |
| **gtfs.stop_times** | Lịch qua từng bến của từng chuyến |
| **gtfs.edges** | Cạnh đồ thị (from_stop, to_stop, route_id, travel_cost) |
| **gtfs.v_stops** | View danh sách bến (autocomplete, bản đồ) |
| **public.users** | Tài khoản |
| **public.route_search_history** | Lịch sử tìm kiếm |
| **public.ratings** | Đánh giá tuyến |

## Bến khớp đường trên bản đồ (snap to road)

Tọa độ GTFS đôi khi lệch so với đường trên bản đồ. Để bến hiển thị đúng trên đường:

1. **Thêm cột snap** (nếu đã chạy post-import trước khi có tính năng này):
   ```bash
   psql -U postgres -d bus_db -f database/migrate-add-snapped-columns.sql
   ```

2. **Chạy script snap** (gọi OSRM Nearest để đưa mỗi bến lên điểm gần nhất trên đường):
   ```bash
   node database/snap-stops-to-road.js
   ```
   - Mặc định ~1 request/giây để tránh giới hạn OSRM public. Với vài nghìn bến có thể mất vài giờ.
   - `--only-null`: chỉ snap những bến chưa có tọa độ snapped.
   - `--delay=500`: gửi request mỗi 500 ms (tăng tốc nhưng dễ bị rate limit).

Sau khi chạy xong, API và view `v_stops` sẽ trả về tọa độ đã snap (khi có), nên marker bến trên bản đồ sẽ nằm sát đường.

## Tối ưu & bến khớp bản đồ

- **Tọa độ**: Chỉ nhận bến có (lat, lon) trong khoảng Hà Nội (schema + script import).
- **Gộp bến**: Bến cách nhau ≤20m được gộp thành một, tọa độ lấy trung bình, làm tròn 6 số thập phân.
- **Snap lên đường**: Dùng `snap-stops-to-road.js` + OSRM Nearest để cập nhật `stop_lat_snapped`, `stop_lon_snapped`; view và backend ưu tiên tọa độ này khi hiển thị.
- **Tên hiển thị**: Có thể bổ sung bảng `gtfs.stop_display_names` (stop_id, display_name) để hiển thị tên địa danh thực tế thay cho mã bến.

## Bổ sung shapes.txt & transfers.txt

- **shapes.txt** (trong từng feed, ví dụ `Dataset/hanoi_gtfs_am/shapes.txt`): chuẩn GTFS – `shape_id`, `shape_pt_lat`, `shape_pt_lon`, `shape_pt_sequence` [, `shape_dist_traveled`]. Nếu **chưa có file**, có thể sinh hình học tuyến từ OSRM:
  ```bash
  node database/generate-shapes-from-osrm.js
  ```
  Script sẽ gọi OSRM route theo thứ tự bến của mỗi tuyến, ghi vào `gtfs.shapes` và cập nhật `trips.shape_id`. Có thể dùng `--delay=1500` để giảm tải OSRM.

- **transfers.txt** (trong từng feed): chuẩn GTFS – `from_stop_id`, `to_stop_id`, `transfer_type`, `min_transfer_time`. Nếu **chưa có file**, post-import sẽ tự tạo bản ghi chuyển tuyến giữa hai bến trong bán kính 300m (đi bộ), dùng cho thuật toán tìm đường. Backend khi load từ DB sẽ dùng bảng `gtfs.transfers` để thêm cạnh chuyển tuyến vào đồ thị.

## Backend

Sau khi import xong, backend (Bus-Route-Finding-Front) sẽ:

1. Khi khởi động, thử load đồ thị từ DB (**gtfs.stops_merged**, **gtfs.edges**).
2. Nếu thành công → dùng DB cho API stops và tìm đường.
3. Nếu không (DB trống hoặc lỗi) → fallback đọc từ CSV trong `Dataset` như trước.

Không cần đổi code API; chỉ cần có database đã import và cấu hình `.env` đúng.
