# One image runs the web app and the investigation worker (they share the database), as a single container.
# Hosting needs: PostgreSQL, one long-running process, and outbound HTTPS to your model provider.
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Install everything first (TypeScript and the build tooling are dev dependencies), build, then drop the dev dependencies.
RUN pnpm install --frozen-lockfile
COPY . .
RUN NODE_ENV=production pnpm build && pnpm prune --prod

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
EXPOSE 3000
# Applies migrations, then starts `next start` (on $PORT, all interfaces) and the worker supervisor. See scripts/start-render.mjs.
CMD ["node", "scripts/start-render.mjs"]
