# Build stage
FROM node:22.0.0-slim AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json for dependency installation
COPY ./app/package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application files
COPY ./app/ ./

# Build the application
RUN npm run build

# Production stage
FROM node:22.0.0-slim AS runner

# Set environment to production
ENV NODE_ENV=production

# Set the working directory
WORKDIR /app

# Copy the built application from the builder stage
COPY --from=builder /app/.next ./.next

# Copy package.json for production dependencies
COPY ./app/package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Expose the application port
EXPOSE 3000

# Command to start the application
CMD ["npm", "start"]