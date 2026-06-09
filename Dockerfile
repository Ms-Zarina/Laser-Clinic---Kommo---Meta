# Production Dockerfile — Laser Clinic Kommo → Meta backend
FROM node:20-alpine

# App listens on this port inside the container (overridable via PORT env)
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3001

# Run as the non-root user that the node image already provides
USER node

# Container-level healthcheck against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
