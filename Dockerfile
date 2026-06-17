# =============================================================================
# Stage 1: Build Next.js frontend
# =============================================================================
FROM node:24-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 2: Python / FastAPI backend
# =============================================================================
FROM python:3.12-slim AS backend
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY backend/start.sh /start.sh
RUN chmod +x /start.sh && \
    useradd -r -u 1001 appuser && \
    chown -R appuser /app

# Starts as root so the entrypoint can fix bind-mount ownership, then drops to
# `appuser` (UID 1001) via gosu — the API process itself runs non-root. See start.sh.
EXPOSE 8000
CMD ["/start.sh"]

# =============================================================================
# Stage 3: Next.js standalone runner
# =============================================================================
FROM node:24-alpine AS frontend
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=frontend-builder /frontend/.next/standalone ./
COPY --from=frontend-builder /frontend/.next/static ./.next/static
COPY --from=frontend-builder /frontend/public ./public

RUN addgroup -S appgroup && adduser -S -u 1001 -G appgroup appuser && \
    chown -R appuser /app
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
