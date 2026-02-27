# Hướng dẫn chạy project Bus Route Finding

Làm theo thứ tự dưới đây. Mở **PowerShell** hoặc **Command Prompt**.

---

## Bước 0: Chuẩn bị

1. **Cài đặt**
   - [PostgreSQL](https://www.postgresql.org/download/windows/) (14 trở lên) – nhớ mật khẩu user `postgres`
   - [Node.js](https://nodejs.org/) (LTS)

2. **Mở terminal tại thư mục gốc project**  
   (nơi có 2 folder: `Dataset` và `database`)

   ```powershell
   cd F:\file\University\GPVer2\BUS-WEB-testtuyenduong\BUS-WEB-testtuyenduong
   ```

3. **Tạo file `.env`** (nếu chưa có)  
   Tạo hoặc sửa file `Bus-Route-Finding-Front\.env` với nội dung:

   ```
   DB_HOST=localhost
   DB_USER=postgres
   DB_PASSWORD=mat_khau_postgres_cua_ban
   DB_NAME=bus_db
   DB_PORT=5432
   ```

   Thay `mat_khau_postgres_cua_ban` bằng mật khẩu PostgreSQL của bạn.

---

## Bước 1: Tạo database và bảng

```powershell
# Tạo database (chạy 1 lần)
psql -U postgres -c "CREATE DATABASE bus_db;"
```

Nếu đã có database rồi thì bỏ qua lệnh trên. Sau đó:

```powershell
# Tạo schema và các bảng
psql -U postgres -d bus_db -f database/schema.sql
```

*(Nếu báo lỗi "psql không nhận diện": thêm đường dẫn PostgreSQL vào PATH, ví dụ `C:\Program Files\PostgreSQL\16\bin`)*

---

## Bước 2: Import dữ liệu GTFS từ Dataset

```powershell
node database/import-gtfs.js
```

Chờ đến khi in ra "Import xong. Tổng: ...".

---

## Bước 3: Chạy post-import (gộp bến, tạo đồ thị, transfers)

```powershell
node database/run-post-import.js
```

Chờ đến khi in "Post-import hoàn tất."

---

## Bước 4: Chạy backend (server)

```powershell
cd Bus-Route-Finding-Front
npm install
npm start
```

Khi chạy ổn sẽ thấy:
- `Server running on http://localhost:3000`
- `App tables ready`
- `[Graph] Loaded from DB: ... stops, ... edges`

---

## Bước 5: Mở giao diện web

Mở trình duyệt và vào:

**http://localhost:3000**

Hoặc mở file `Bus-Route-Finding-Front/homepage.html` trực tiếp (cần server đang chạy để API hoạt động).

---

## Tóm tắt lệnh (copy & paste)

```powershell
cd F:\file\University\GPVer2\BUS-WEB-testtuyenduong\BUS-WEB-testtuyenduong

psql -U postgres -c "CREATE DATABASE bus_db;"
psql -U postgres -d bus_db -f database/schema.sql
node database/import-gtfs.js
node database/run-post-import.js

cd Bus-Route-Finding-Front
npm install
npm start
```

Sau đó mở http://localhost:3000 trên trình duyệt.

---

## Lỗi thường gặp

| Lỗi | Cách xử lý |
|-----|------------|
| `Cannot find module 'pg'` | Đảm bảo chạy từ thư mục có folder `database`; script sẽ tự tìm `Bus-Route-Finding-Front/node_modules`. Hoặc chạy `cd Bus-Route-Finding-Front` rồi `npm install` trước. |
| `password authentication failed` | Kiểm tra `DB_PASSWORD` trong `Bus-Route-Finding-Front\.env` đúng mật khẩu PostgreSQL. |
| `database "bus_db" does not exist` | Chạy `psql -U postgres -c "CREATE DATABASE bus_db;"` trước. |
| `psql` không tìm thấy | Thêm thư mục `bin` của PostgreSQL vào biến môi trường PATH. |
