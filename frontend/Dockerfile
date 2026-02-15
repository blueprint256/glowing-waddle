# ================================
# Stage 1: Build Stage
# ================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json yarn.lock* ./

# Install dependencies
RUN npm ci

# Copy source code and config files
COPY . .

# Build the application for production
RUN npm run build

# ================================
# Stage 2: Production Stage (Nginx)
# ================================
FROM nginx:alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Create script to inject environment variables at runtime
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-inject-env.sh && \
    echo 'envsubst < /usr/share/nginx/html/env-config.template.js > /usr/share/nginx/html/env-config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    chmod +x /docker-entrypoint.d/40-inject-env.sh

# Create environment config template
RUN echo 'window.__ENV__ = { VITE_API_URL: "${VITE_API_URL}" };' > /usr/share/nginx/html/env-config.template.js

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Nginx runs as non-root by default in Alpine image
CMD ["nginx", "-g", "daemon off;"]
