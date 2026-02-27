# Hướng dẫn Deploy – Bus Route Finding

## Tóm tắt thay đổi

Dự án đã được chỉnh để **deploy được** (local vẫn chạy mượt, không đổi hành vi).

---

## Danh sách file

### File được thêm mới

| File | Mô tả |
|------|--------|
| `Bus-Route-Finding-Front/config.js` | Cấu hình `API_BASE`: local → localhost:3000, production → same origin |
| `Bus-Route-Finding-Front/.env.example` | Mẫu biến môi trường (PORT, DB_*, JWT_SECRET) |
| `Dockerfile` | Build Docker từ thư mục gốc repo (app + Dataset) |
| `.dockerignore` | Bỏ node_modules, .env khỏi context build |
| `DEPLOY.md` | File này – hướng dẫn deploy và liệt kê file |

### File được sửa

| File | Thay đổi |
|------|----------|
| `Bus-Route-Finding-Front/index.html` | Thêm `<script src="config.js"></script>`, dùng `window.API_BASE` thay hardcode |
| `Bus-Route-Finding-Front/homepage.html` | Giống trên |
| `Bus-Route-Finding-Front/indexeng.html` | Giống trên |
| `Bus-Route-Finding-Front/homepageeng.html` | Giống trên |
| `Bus-Route-Finding-Front/src/index.js` | Thêm `path`, serve static frontend, middleware chặn `.env` / `node_modules` / `src` |
| `Bus-Route-Finding-Front/src/services/graphService.js` | `getDatasetPath()` hỗ trợ cả local (../../../Dataset) và Docker (../../Dataset + DATASET_PATH) |

---

## Chạy local (như cũ)

```bash
cd Bus-Route-Finding-Front
cp .env.example .env   # rồi sửa .env
npm install
node src/index.js
```

Mở http://localhost:3000 — frontend và API dùng `config.js` (localhost:3000).

---

## Deploy một máy (Express serve cả frontend + API)

1. **Railway / Render / VPS**: đẩy repo, cấu hình biến môi trường từ `.env.example`, chạy `npm install && node src/index.js` (root là `Bus-Route-Finding-Front`).  
2. **Cần**: PostgreSQL (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT), JWT_SECRET, PORT (nếu có).  
3. Frontend và API cùng domain → `config.js` tự dùng same origin, không cần sửa gì thêm.

---

## Deploy bằng Docker

**Hướng dẫn chi tiết từng bước:** xem **[DOCKER-DEPLOY.md](./DOCKER-DEPLOY.md)** (yêu cầu, build, chạy container, Docker Compose, biến môi trường, xử lý lỗi).

Tóm tắt nhanh — build từ **thư mục gốc repo** (có cả `Bus-Route-Finding-Front` và `Dataset`):

```bash
cd bus_project
docker build -f Dockerfile -t bus-route-app .
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e DB_HOST=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=... -e DB_PORT=5432 \
  -e JWT_SECRET=... \
  bus-route-app
```

Hoặc dùng **Docker Compose** (app + PostgreSQL trong một lệnh): tạo `.env` từ `.env.example` ở thư mục gốc, rồi chạy `docker compose up -d --build`. Chi tiết trong DOCKER-DEPLOY.md.

---

## Deploy tách frontend / backend (ví dụ front Vercel, back Railway)

- Backend: deploy Node (Railway, Render…) như trên, lấy URL API (ví dụ `https://xxx.railway.app`).  
- Frontend: khi build/deploy, set `window.API_BASE` trước khi load `config.js`, ví dụ trong `<head>`:

```html
<script>window.API_BASE = 'https://xxx.railway.app';</script>
<script src="config.js"></script>
```

Như vậy frontend sẽ gọi đúng API production.
