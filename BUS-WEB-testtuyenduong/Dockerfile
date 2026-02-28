# Build từ thư mục gốc repo (bus_project) để có cả Bus-Route-Finding-Front và Dataset
# docker build -f Dockerfile -t bus-route-app .
# docker run -p 3000:3000 -e DB_HOST=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=... -e JWT_SECRET=... bus-route-app

FROM node:20-alpine

WORKDIR /app

# Copy toàn bộ frontend + backend (trừ node_modules, .env)
COPY Bus-Route-Finding-Front/ ./
RUN rm -rf node_modules .env 2>/dev/null; true

COPY Dataset ./Dataset
# Copy thư mục database để có thể chạy import GTFS trong container (sau khi docker compose up)
COPY database ./database

RUN npm ci --omit=dev

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "src/index.js"]
