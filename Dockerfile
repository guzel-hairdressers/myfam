# Minimal Alpine Node Image (~50MB total)
FROM node:22-alpine

WORKDIR /app

# Copy dependency definition
COPY package.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Expose standard port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Run without root privileges for security
USER node

CMD ["node", "server.js"]
