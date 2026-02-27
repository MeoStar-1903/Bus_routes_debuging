/**
 * Cấu hình base URL cho API backend.
 * - Local: http://localhost:3000
 * - Deploy cùng domain (Express serve static): dùng same origin
 * - Deploy tách (front Vercel/Netlify, back Railway): set window.API_BASE trước khi load file này (ví dụ trong index.html)
 */
(function () {
  if (typeof window.API_BASE !== 'undefined') return;
  var h = window.location.hostname;
  var origin = window.location.origin;
  // [SỬA] Khi mở file trực tiếp (file://) hoặc origin không hợp lệ thì dùng localhost để đăng ký/đăng nhập hoạt động
  if (h === 'localhost' || h === '127.0.0.1' || !origin || origin === 'null' || origin.indexOf('http') !== 0) {
    window.API_BASE = 'http://localhost:3000';
  } else {
    window.API_BASE = origin;
  }
})();
