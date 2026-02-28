# Hướng dẫn tạo Database cho nhà phát triển

Tài liệu mô tả cách **tạo mới hoàn toàn** database PostgreSQL cho project Bus Route Finding, bao gồm **snap bến lên đường**, **transfers (chuyển tuyến)** và **shapes (hình học tuyến)**. Thực hiện đúng thứ tự các bước bên dưới.

---

## 1. Yêu cầu

| Thành phần | Yêu cầu |
|------------|--------|
| PostgreSQL | Phiên bản 14 trở lên |
| Node.js | Để chạy các script import (dùng `pg`, `dotenv` từ `Bus-Route-Finding-Front`) |
| Dữ liệu | Folder **Dataset** với các feed GTFS: `hanoi_gtfs_am`, `hanoi_gtfs_md`, `hanoi_gtfs_pm` |

Cấu trúc tối thiểu mỗi feed:

- `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`
- Tùy chọn: `shapes.txt`, `transfers.txt` (xem mục 7 và 8)

---

## 2. Cấu hình môi trường

Tạo file **`Bus-Route-Finding-Front/.env`** (hoặc `.env` ở thư mục gốc project):

```env
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=bus_db
DB_PORT=5432
```

Chạy mọi lệnh từ **thư mục gốc project** (nơi có folder `Dataset` và `database`).

---

## 3. Tạo database và schema

```bash
# Tạo database
psql -U postgres -c "CREATE DATABASE bus_db;"

# Tạo schema và toàn bộ bảng
psql -U postgres -d bus_db -f database/schema.sql
```

Schema tạo:

- **Schema `gtfs`**: `calendar`, `routes`, `stops`, `trips`, `stop_times`, `shapes`, `transfers`, `stop_display_names`, hàm `haversine_m`, `time_to_seconds`
- **Schema `public`**: `users`, `route_search_history`, `ratings`

*(Đổi `bus_db` nếu dùng tên khác; phải trùng `DB_NAME` trong `.env`.)*

---

## 4. Import dữ liệu GTFS

```bash
node database/import-gtfs.js
```

Script đọc 3 feed (`hanoi_gtfs_am`, `hanoi_gtfs_md`, `hanoi_gtfs_pm`) và import:

| Dữ liệu | Bảng |
|--------|------|
| calendar.txt | gtfs.calendar |
| routes.txt | gtfs.routes |
| stops.txt | gtfs.stops (chỉ bến trong vùng Hà Nội) |
| trips.txt | gtfs.trips |
| stop_times.txt | gtfs.stop_times |
| shapes.txt (nếu có) | gtfs.shapes |
| transfers.txt (nếu có) | gtfs.transfers |

Chờ in ra "Import xong. Tổng: ..." rồi chuyển sang bước 5.

---

## 5. Post-import: gộp bến, đồ thị, transfers mặc định, views

```bash
node database/run-post-import.js
```

Hoặc dùng psql:

```bash
psql -U postgres -d bus_db -f database/post-import.sql
```

Post-import thực hiện:

1. **stop_merge_map** – Gộp bến trong bán kính 20m về một bến đại diện.
2. **stops_merged** – Bảng bến đã gộp (có sẵn cột `stop_lat_snapped`, `stop_lon_snapped` cho bước snap).
3. **stop_times_merged** – Lịch qua bến theo `stop_id` đã gộp.
4. **edges** – Cạnh đồ thị cho thuật toán tìm đường.
5. **Transfers mặc định** – Tự sinh chuyển tuyến giữa hai bến trong 300m (chỉ khi bảng `gtfs.transfers` trống, tức chưa có `transfers.txt`).
6. Index và views **v_stops**, **v_route_stops**.

Chờ in "Post-import hoàn tất." rồi tiếp tục.

---

## 6. Snap bến lên đường (Snap to road) – Bắt buộc

Để marker bến hiển thị sát đường trên bản đồ, **bắt buộc** chạy:

```bash
node database/snap-stops-to-road.js
```

Script gọi **OSRM Nearest** cho từng bến trong `gtfs.stops_merged`, cập nhật `stop_lat_snapped`, `stop_lon_snapped`.

| Tùy chọn | Ý nghĩa |
|----------|--------|
| *(mặc định)* | Snap toàn bộ bến; ~1 request/giây. |
| `--only-null` | Chỉ snap bến chưa có tọa độ snapped. |
| `--delay=500` | Gửi request mỗi 500 ms (nhanh hơn, dễ bị rate limit). |

Có thể dùng OSRM khác qua biến môi trường:

```env
OSRM_NEAREST_URL=https://your-osrm-server/nearest/v1/driving
```

---

## 7. Transfers (chuyển tuyến)

- **Có file transfers.txt**: Đặt trong từng feed (vd. `Dataset/hanoi_gtfs_am/transfers.txt`) với cột `from_stop_id`, `to_stop_id`, `transfer_type`, `min_transfer_time`. Chạy lại **bước 4** (import) trước khi chạy **bước 5** (post-import). Post-import chỉ thêm transfers mặc định khi bảng đang trống.
- **Không có transfers.txt**: Không cần làm gì thêm; post-import đã tạo sẵn transfers mặc định (bến trong 300m) ở bước 5.

---

## 8. Shapes (hình học tuyến) – Bắt buộc

- **Có file shapes.txt**: Đặt trong từng feed (vd. `Dataset/hanoi_gtfs_am/shapes.txt`) với cột `shape_id`, `shape_pt_lat`, `shape_pt_lon`, `shape_pt_sequence`. Chạy lại **bước 4** (import).
- **Không có shapes.txt**: **Bắt buộc** chạy script sinh từ OSRM sau khi đã chạy xong bước 5:

```bash
node database/generate-shapes-from-osrm.js
```

Script lấy thứ tự bến của mỗi tuyến, gọi OSRM Route, ghi vào `gtfs.shapes` và cập nhật `gtfs.trips.shape_id`.

| Tùy chọn | Ý nghĩa |
|----------|--------|
| `--delay=2000` | (mặc định) Request mỗi 2 giây. |
| `--delay=1500` | Nhanh hơn. |

Có thể đặt URL OSRM:

```env
OSRM_ROUTE_URL=https://your-osrm-server
```

---

## 9. Thứ tự thao tác tổng quát

| Bước | Lệnh |
|------|------|
| 1 | `psql -U postgres -c "CREATE DATABASE bus_db;"` |
| 2 | `psql -U postgres -d bus_db -f database/schema.sql` |
| 3 | `node database/import-gtfs.js` |
| 4 | `node database/run-post-import.js` |
| 5 | **(Bắt buộc)** `node database/snap-stops-to-road.js` |
| 6 | **(Bắt buộc)** `node database/generate-shapes-from-osrm.js` |
| 7 | `cd Bus-Route-Finding-Front && npm start` |

---

## 10. Tóm tắt file trong `database/`

| File | Mục đích |
|------|----------|
| **schema.sql** | Tạo schema gtfs, toàn bộ bảng (routes, stops, trips, stop_times, shapes, transfers, …), bảng app, hàm tiện ích. |
| **import-gtfs.js** | Import GTFS từ Dataset (calendar, routes, stops, trips, stop_times, shapes, transfers nếu có). |
| **post-import.sql** | Gộp bến, stops_merged, stop_times_merged, edges, transfers mặc định, index, views. |
| **run-post-import.js** | Chạy post-import.sql bằng Node. |
| **snap-stops-to-road.js** | Cập nhật stop_lat_snapped, stop_lon_snapped bằng OSRM Nearest. |
| **generate-shapes-from-osrm.js** | Sinh gtfs.shapes từ OSRM Route. |
| **README.md** | Tổng quan database. |
| **RUN.md** | Hướng dẫn chạy nhanh project (DB + server). |

---

## 11. Lỗi thường gặp

| Lỗi | Cách xử lý |
|-----|------------|
| `Cannot find module 'pg'` | Chạy từ thư mục gốc project; script dùng `Bus-Route-Finding-Front/node_modules`. Hoặc `cd Bus-Route-Finding-Front && npm install` trước. |
| `password authentication failed` | Kiểm tra `DB_PASSWORD` trong `.env`. |
| `database "bus_db" does not exist` | Chạy bước 1: `psql -U postgres -c "CREATE DATABASE bus_db;"`. |
| Snap/Shapes bị rate limit OSRM | Tăng `--delay` hoặc dùng OSRM self-host (biến môi trường tương ứng). |

---

Tài liệu dùng cho **tạo mới database từ đầu**. Chi tiết bảng/view xem **database/README.md**.

---

## 12. Chạy với Docker

Khi dùng **Docker Compose**, schema đã được áp dụng tự động lần đầu (file `schema.sql` mount vào Postgres init). Sau khi `docker compose up -d`, chạy import **trong container app**:

```bash
docker compose exec app node database/import-gtfs.js
docker compose exec app node database/run-post-import.js
```

Snap bến và sinh shapes (nếu cần) chạy tương tự: `docker compose exec app node database/snap-stops-to-road.js` và `docker compose exec app node database/generate-shapes-from-osrm.js`. Xem **DOCKER-DEPLOY.md** để cấu hình `.env` và các bước đầy đủ.
