# Backend-Image für das QNAP (Container Station / docker-compose).
# Multi-Stage: TypeScript bauen, dann schlankes Runtime-Image.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build-Tools für native Module (better-sqlite3, sharp).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg/ffprobe für Video-Poster + Vorschau. Ausserdem Build-Tools, falls für
# better-sqlite3/sharp ein Quell-Build nötig ist (sonst werden Prebuilds genutzt).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Fotos/Videos, DB und temporäre Uploads liegen auf einem gemounteten Volume.
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "dist/index.js"]
