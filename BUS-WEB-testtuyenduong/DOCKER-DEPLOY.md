# Hướng dẫn Deploy Bus Route Finding bằng Docker (chi tiết)

Tài liệu này hướng dẫn từng bước để chạy ứng dụng **Bus Route Finding** trong Docker (và tùy chọn dùng Docker Compose với PostgreSQL).

---

## 1. Yêu cầu trước khi deploy

### 1.1 Cài đặt

- **Docker** (Engine 20.10+): [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose** (v2): thường đi kèm Docker Desktop, hoặc cài riêng

Kiểm tra:

```bash
docker --version
docker compose version
```

### 1.2 Cấu trúc thư mục repo

Build Docker **bắt buộc** chạy từ **thư mục gốc** của repo (`bus_project`), vì Dockerfile cần cả:

- `Bus-Route-Finding-Front/` – mã nguồn app (Express + frontend)
- `Dataset/` – dữ liệu GTFS (các thư mục `hanoi_gtfs_am`, `hanoi_gtfs_md`, `hanoi_gtfs_pm` với file `stops.txt`, `trips.txt`, `stop_times.txt`)

Nếu chưa có thư mục `Dataset` ở thư mục gốc:

```text
bus_project/
├── Bus-Route-Finding-Front/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── ...
├── Dataset/                    ← BẮT BUỘC có thư mục này
│   ├── hanoi_gtfs_am/
│   │   ├── stops.txt
│   │   ├── trips.txt
│   │   └── stop_times.txt
│   ├── hanoi_gtfs_md/
│   └── hanoi_gtfs_pm/
├── Dockerfile
├── .dockerignore
└── docker-compose.yml
```

Nếu thiếu `Dataset/`, lệnh `docker build` sẽ báo lỗi ở bước `COPY Dataset ./Dataset`.

### 1.3 PostgreSQL (cho đăng nhập, lịch sử, đánh giá)

- Ứng dụng dùng PostgreSQL để: auth (users), lịch sử tìm kiếm, đánh giá tuyến.
- Bạn cần có **một PostgreSQL** đang chạy (trên máy, VPS, hoặc Docker). Biến môi trường: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, và `JWT_SECRET`.

---

## 2. Deploy chỉ với Docker (không Compose)

Dùng khi bạn đã có sẵn PostgreSQL (local hoặc remote).

### Bước 1: Mở terminal tại thư mục gốc repo

```bash
cd C:\Users\tranv\Downloads\bus_project
```

(Trên Linux/macOS: `cd /đường/dẫn/tới/bus_project`)

### Bước 2: Build image

```bash
docker build -f Dockerfile -t bus-route-app .
```

- `-f Dockerfile`: dùng file `Dockerfile` ở thư mục hiện tại.
- `-t bus-route-app`: đặt tên image là `bus-route-app`.
- `.`: context build là thư mục hiện tại (phải chứa `Bus-Route-Finding-Front` và `Dataset`).

Nếu build thành công, chạy `docker images` sẽ thấy image `bus-route-app`.

### Bước 3: Chạy container với biến môi trường

Thay các giá trị `...` bằng thông tin PostgreSQL và JWT thật của bạn:

```bash
docker run -p 3000:3000 ^
  -e PORT=3000 ^
  -e DB_HOST=host.docker.internal ^
  -e DB_USER=postgres ^
  -e DB_PASSWORD=your_password ^
  -e DB_NAME=postgres ^
  -e DB_PORT=5432 ^
  -e JWT_SECRET=your-jwt-secret-change-in-production ^
  bus-route-app
```

**Lưu ý:**

- **Windows (CMD):** dùng `^` để xuống dòng; **PowerShell:** dùng `` ` `` (backtick) thay cho `^`.
- **Linux/macOS:** bỏ `^`, dùng `\` để xuống dòng.

**PostgreSQL chạy trên máy host (Windows/Mac):**

- Dùng `DB_HOST=host.docker.internal` để container truy cập PostgreSQL trên máy bạn.
- Đảm bảo PostgreSQL cho phép kết nối (listen đúng port, không chặn firewall).

**PostgreSQL chạy trên server khác:**

- Đặt `DB_HOST=ip-hoặc-domain-của-postgres`, `DB_PORT=5432` (hoặc port thật).

Ví dụ một dòng (Windows CMD):

```bash
docker run -p 3000:3000 -e PORT=3000 -e DB_HOST=host.docker.internal -e DB_USER=postgres -e DB_PASSWORD=your_password -e DB_NAME=postgres -e DB_PORT=5432 -e JWT_SECRET=my-secret bus-route-app
```

### Bước 4: Kiểm tra

- Mở trình duyệt: **http://localhost:3000**
- App sẽ tự tạo bảng (users, ratings, route_search_history) khi kết nối DB thành công. Nếu DB sai/sai mật khẩu, app vẫn chạy nhưng auth/lịch sử/đánh giá có thể không hoạt động; tìm đường vẫn dùng được (dữ liệu từ Dataset trong image).

### Chạy nền (detach)

```bash
docker run -d -p 3000:3000 -e PORT=3000 -e DB_HOST=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=... -e DB_PORT=5432 -e JWT_SECRET=... --name bus-app bus-route-app
```

- Dừng: `docker stop bus-app`
- Xóa container: `docker rm bus-app`

---

## 3. Deploy bằng Docker Compose (app + PostgreSQL)

Cách này tự động chạy **PostgreSQL** trong Docker và **app** kết nối tới nó, chỉ cần một lệnh.

### Bước 1: Tạo file `.env` (không commit lên git)

Tại thư mục gốc `bus_project`, tạo file `.env` (có thể copy từ `Bus-Route-Finding-Front/.env.example` rồi chỉnh):

```env
PORT=3000
DB_HOST=db
DB_USER=postgres
DB_PASSWORD=your_strong_password_here
DB_NAME=busdb
DB_PORT=5432
JWT_SECRET=your-jwt-secret-change-in-production
```

- `DB_HOST=db`: tên service PostgreSQL trong `docker-compose.yml` (container nội bộ).
- `DB_PASSWORD` và `JWT_SECRET`: đổi thành giá trị an toàn.

### Bước 2: Chạy Compose

Vẫn ở thư mục gốc repo:

```bash
docker compose up -d --build
```

- `--build`: build lại image app nếu có thay đổi.
- `-d`: chạy nền.

Lần đầu sẽ build image và tạo container PostgreSQL + app. App sẽ listen cổng **3000**.

### Bước 3: Kiểm tra

- Trình duyệt: **http://localhost:3000**
- Xem log app: `docker compose logs -f app`
- Xem log DB: `docker compose logs -f db`

### Các lệnh thường dùng

| Lệnh | Mô tả |
|------|--------|
| `docker compose up -d --build` | Build và chạy (nền) |
| `docker compose down` | Dừng và xóa container (giữ volume DB) |
| `docker compose down -v` | Dừng và xóa cả volume (DB mất dữ liệu) |
| `docker compose logs -f app` | Xem log app |
| `docker compose ps` | Liệt kê container đang chạy |

---

## 4. Biến môi trường đầy đủ

| Biến | Bắt buộc | Mô tả | Ví dụ |
|------|----------|--------|--------|
| `PORT` | Không | Cổng app trong container (mặc định 3000) | `3000` |
| `DB_HOST` | Có (nếu dùng auth/history) | Host PostgreSQL | `localhost`, `host.docker.internal`, `db` (Compose) |
| `DB_USER` | Có | User PostgreSQL | `postgres` |
| `DB_PASSWORD` | Có | Mật khẩu PostgreSQL | (mật khẩu của bạn) |
| `DB_NAME` | Có | Tên database | `postgres`, `busdb` |
| `DB_PORT` | Không | Port PostgreSQL (mặc định 5432) | `5432` |
| `JWT_SECRET` | Có (cho đăng nhập) | Chuỗi bí mật ký JWT | Chuỗi dài, ngẫu nhiên |
| `DATASET_PATH` | Không | Đường dẫn tuyệt đối tới thư mục Dataset trong container (mặc định `/app/Dataset`) | Thường không cần set |

---

## 5. Dùng file `.env` khi chạy container (không dùng Compose)

Nếu bạn có file `.env` (ví dụ `Bus-Route-Finding-Front/.env`) và **không** commit lên git:

```bash
docker run -p 3000:3000 --env-file Bus-Route-Finding-Front/.env bus-route-app
```

Docker sẽ đọc các biến từ file và truyền vào container. Đảm bảo trong `.env` có đủ `DB_*` và `JWT_SECRET`, và khi chạy trong Docker thì `DB_HOST` phải là địa chỉ mà container truy cập được (ví dụ `host.docker.internal` hoặc `db` nếu dùng Compose).

---

## 6. Xử lý lỗi thường gặp

### Build báo "COPY Dataset ./Dataset" failed

- Thư mục `Dataset` không tồn tại ở thư mục gốc repo. Tạo `bus_project/Dataset` và đặt đúng cấu trúc GTFS (xem mục 1.2).

### App chạy nhưng đăng nhập / lịch sử không được

- Kiểm tra `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` (và với Docker: dùng `host.docker.internal` nếu DB chạy trên host).
- Xem log: `docker logs <container_id>` hoặc `docker compose logs app`.

### "Cannot connect to PostgreSQL" / "password authentication failed"

- PostgreSQL phải chạy và listen đúng port.
- Trong Docker: không dùng `localhost` cho DB trên host, dùng `host.docker.internal` (Windows/Mac). Linux: dùng `--add-host=host.docker.internal:host-gateway` khi `docker run` hoặc IP máy host.

### Cổng 3000 đã bị chiếm

Đổi port khi chạy container, ví dụ map 8080 (host) → 3000 (container):

```bash
docker run -p 8080:3000 ...
```

Sau đó mở **http://localhost:8080**.

---

## 7. Tóm tắt lệnh nhanh

**Chỉ Docker (đã có PostgreSQL):**

```bash
cd bus_project
docker build -f Dockerfile -t bus-route-app .
docker run -p 3000:3000 -e DB_HOST=host.docker.internal -e DB_USER=postgres -e DB_PASSWORD=xxx -e DB_NAME=postgres -e DB_PORT=5432 -e JWT_SECRET=xxx bus-route-app
```

**Docker Compose (app + PostgreSQL):**

```bash
cd bus_project
# Tạo .env với DB_HOST=db, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET
docker compose up -d --build
# Mở http://localhost:3000
```

Sau khi đọc kỹ code và cấu hình, bạn có thể deploy theo đúng một trong hai cách trên. Nếu bạn gửi thêm lỗi cụ thể (log hoặc ảnh màn hình), có thể xử lý từng bước tiếp.
