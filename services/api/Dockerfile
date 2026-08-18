# Node 24 runs the TypeScript directly, so there is no build stage - the same property
# that lets `npm run mock-server` start with no build step.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY services/api ./services/api

ENV NODE_ENV=production
EXPOSE 8788

CMD ["node", "services/api/src/cli.ts"]
