const express = require('express');
const path = require('path');
const db = require('./db');
const routesRouter = require('./routes/routes.routes');
// [ADDED] CORS, JSON body, API routes, init DB, graph service theo report
const cors = require('cors');
const apiRoutes = require('./routes/api.routes');
const { initAppTables } = require('./db/init');
const graphService = require('./services/graphService');

const app = express();

// [ADDED] Middleware theo report (NFR5, REST/JSON)
app.use(cors());
app.use(express.json());

app.use('/routes', routesRouter);
// [ADDED] Mount tất cả API dưới /api
app.use('/api', apiRoutes);

// [DEPLOY] Serve frontend tĩnh (tránh lộ .env, node_modules, src)
app.use((req, res, next) => {
  if (req.path.includes('.env') || req.path.includes('node_modules') || req.path.startsWith('/src')) return res.status(404).end();
  next();
});
app.use(express.static(path.join(__dirname, '..')));

// [ADDED] Khởi tạo bảng ứng dụng và load đồ thị khi start; server luôn listen trước
// [SỬA] Khi DB lỗi (sai mật khẩu / PostgreSQL tắt) chỉ in cảnh báo, vẫn load graph để tìm đường chạy được
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
  (async () => {
    try {
      await initAppTables();
    } catch (err) {
      console.warn('DB init warning (auth/ratings/history may not work):', err.message);
    }
    try {
      const useDb = await graphService.loadGraphFromDb(db);
      if (!useDb) graphService.loadGraphFromCSV();
    } catch (err) {
      console.warn('Graph load warning (route search may fail):', err.message);
    }
  })();
});
