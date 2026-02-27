# Phản hồi Codebase & Roadmap – Ứng dụng Tìm tuyến xe buýt

## Phần 1: Phân tích cấu trúc hiện tại

### Backend (Node.js/Express)

| Thành phần | Mô tả |
|------------|--------|
| **Entry** | `src/index.js` – mount `/routes`, `/api`, serve static, init DB + load graph khi start |
| **API routes** | `src/routes/api.routes.js` – auth, `/api/stops`, `/api/stops/nearest`, `/api/routes/search`, ratings, history |
| **Controllers** | `stops.controller`, `routesSearch.controller`, `auth.controller`, v.v. – gọi service, trả JSON |
| **graphService.js** | Load GTFS từ **CSV** (không từ PostgreSQL), merge stops 20m, Dijkstra (transfer penalty) + BFS, `pathToSteps` |
| **Database** | `pg` pool; `db/init.js` tạo bảng `users`, `route_search_history`, `ratings`. **GTFS không lưu trong DB** |

**Nhận xét ngắn:** Logic tìm đường tốt (Dijkstra + penalty), nhưng dữ liệu GTFS chỉ từ file CSV, không dùng spatial index hay pgRouting.

### Frontend (HTML/CSS/JS thuần)

| Thành phần | Mô tả |
|------------|--------|
| **Map** | Leaflet + OSM tiles, Geocoder |
| **Trước refactor** | Toàn bộ logic trong inline script: click → nearest stop (marker không snap), tìm đường → polyline thẳng giữa các stop |
| **Sau refactor** | `js/api.js` (API + OSRM), `js/mapService.js` (map, trạm, snap, vẽ tuyến theo đường), homepage chỉ còn UI + glue |

---

## Phần 2: Những thiếu sót để thành sản phẩm thực tế

1. **Database & GTFS**
   - GTFS chỉ đọc từ CSV khi start; không có bảng `stops`, `trips`, `stop_times` trong PostgreSQL.
   - Thiếu **spatial index** (PostGIS) cho truy vấn theo bbox/nearest nếu sau này đưa GTFS vào DB.
   - Không có **pgRouting** hoặc OSRM self-hosted cho routing đường bộ phía server (hiện OSRM public gọi từ frontend).

2. **Hiển thị hình dạng tuyến (shape)**
   - Chưa dùng `shapes.txt` (GTFS). Tuyến đang vẽ bằng: (1) đoạn thẳng giữa các stop, hoặc (2) OSRM driving giữa các stop. Để “đúng đường xe chạy” cần shapes.txt hoặc map-matching.

3. **Xử lý lỗi & bảo mật**
   - Nhiều route chỉ `console.error`/`console.warn`, chưa chuẩn hóa response lỗi (code, message).
   - Chưa rate limit cho API; OSRM public có giới hạn ~1 req/s.
   - Input (stopId, bbox) chưa validate kỹ (SQL injection không áp dụng vì không query GTFS từ DB).

4. **Performance & scale**
   - `getNearestStop` duyệt toàn bộ stops (O(n)); với hàng chục nghìn trạm nên dùng spatial index (PostGIS hoặc R-tree trong memory).
   - Stops trong viewport: đã hỗ trợ bbox ở backend; frontend gọi theo `moveend` – ổn, có thể thêm debounce.

5. **Testing & CI**
   - Chưa thấy unit test cho graphService (Dijkstra, pathToSteps), integration test cho API, hay E2E cho flow tìm đường.

6. **Documentation**
   - Thiếu mô tả API (OpenAPI/Swagger), thiếu hướng dẫn import GTFS (CSV vs DB), biến môi trường.

---

## Phần 3: Checklist Roadmap hoàn thiện dự án

### Giai đoạn 1 – Ổn định & vận hành cơ bản
- [ ] **Env & deploy:** Ghi rõ trong README `.env` (PORT, DB_*, DATASET_PATH, JWT_SECRET); hướng dẫn chạy local và Docker.
- [ ] **Lỗi API:** Chuẩn hóa format lỗi (ví dụ `{ error: string, code?: string }`), HTTP status đúng (4xx/5xx).
- [ ] **OSRM:** Nếu dùng production, cân nhắc self-host OSRM hoặc Mapbox/GraphHopper để tránh giới hạn public server.

### Giai đoạn 2 – Dữ liệu & độ chính xác
- [ ] **GTFS trong PostgreSQL (tùy chọn):** Script import `stops`, `routes`, `trips`, `stop_times` vào DB; thêm PostGIS, spatial index cho `stops`.
- [ ] **Nearest stop nhanh:** Nếu GTFS trong DB: dùng PostGIS `ST_DWithin`/KNN; nếu giữ CSV: dùng R-tree (vd. rbush) trong memory.
- [ ] **Shapes.txt:** Nếu có file shapes.txt, load và dùng `shape_id` từ trips → vẽ đúng geometry tuyến thay vì chỉ OSRM giữa các stop.

### Giai đoạn 3 – Chất lượng code & bảo mật
- [ ] **Rate limiting:** Thêm express-rate-limit (hoặc tương đương) cho `/api/*`.
- [ ] **Validation:** Validate query (bbox, limit, origin/dest) và body (auth, ratings) bằng Joi/express-validator.
- [ ] **Unit test:** graphService (Dijkstra, pathToSteps, getStops với bbox), và test API `/api/stops`, `/api/routes/search`.

### Giai đoạn 4 – Trải nghiệm người dùng
- [ ] **Loading state:** Hiển thị loading khi gọi OSRM / search route để tránh tưởng treo.
- [ ] **Fallback khi OSRM lỗi:** Đã có: fallback vẽ đường thẳng; có thể thêm thông báo “Đang hiển thị đường gần đúng”.
- [ ] **Tùy chọn mode:** Cho user chọn “Nhanh nhất” / “Ít trạm nhất” (đã có backend `mode=fewest_stops`).

### Giai đoạn 5 – Mở rộng (sau này)
- [ ] **API documentation:** OpenAPI/Swagger cho toàn bộ `/api/*`.
- [ ] **Real-time (optional):** Nếu có dữ liệu real-time GTFS-RT, hiển thị xe đang chạy hoặc delay.
- [ ] **Cache:** Cache response OSRM (theo chuỗi tọa độ) để giảm gọi ngoài.

---

## Tóm tắt thay đổi đã thực hiện trong lần refactor này

| File | Thay đổi |
|------|----------|
| `src/services/graphService.js` | `getStops(search, opts)` hỗ trợ `opts`: bbox (`minLat`, `maxLat`, `minLon`, `maxLon`) và `limit`. |
| `src/controllers/stops.controller.js` | `getStops` đọc query `minLat`, `maxLat`, `minLon`, `maxLon`, `limit` và truyền vào graphService. |
| `js/api.js` | **Mới.** Layer gọi API: getStops, getNearestStop, searchRoutes, getOSRMRoute (OSRM public). |
| `js/mapService.js` | **Mới.** Layer bản đồ: initMap, getOrderedCoordinatesFromRoute, drawRouteWithRoadNetwork (OSRM), addStopMarkers, snapMarkerToStop, loadAndShowStopsInView. |
| `homepage.html` | Dùng api.js + mapService.js; load trạm trong viewport; snap marker về tọa độ trạm khi chọn và khi kéo; vẽ tuyến qua OSRM (road network); dragend re-snap. |
| `homepageeng.html` | Đồng bộ logic với homepage.html (bản tiếng Anh). |

Sau các thay đổi này:
1. **Trạm xe buýt** được hiển thị trên bản đồ (trong viewport), cập nhật khi kéo bản đồ.
2. **Tuyến đường** bám đường xá nhờ OSRM (fallback đường thẳng nếu OSRM lỗi).
3. **Snapping:** Điểm A/B được snap về đúng tọa độ trạm gần nhất và re-snap khi kéo marker.
