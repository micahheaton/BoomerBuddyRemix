FROM node:22.13.1-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/hq/package.json apps/hq/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/authorization/package.json packages/authorization/package.json
COPY packages/business-os/package.json packages/business-os/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/design/package.json packages/design/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/eval-lab/package.json packages/eval-lab/package.json
COPY packages/fraud/package.json packages/fraud/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/persistence/package.json packages/persistence/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/testkit/package.json packages/testkit/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build -w @boomerbuddy/api && npm run build -w @boomerbuddy/worker

FROM node:22.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /workspace/apps/worker/dist ./apps/worker/dist
COPY --from=build /workspace/packages/persistence/migrations ./packages/persistence/migrations
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
