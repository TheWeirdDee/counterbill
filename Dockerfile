# One image runs the web app and the investigation worker (they share the database).
# Hosting needs: PostgreSQL, one long-running process for the worker, and outbound HTTPS to your model provider.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
# `start:all` runs `next start` and the worker supervisor side by side; migrations run when the worker boots.
CMD ["pnpm", "start:all"]
