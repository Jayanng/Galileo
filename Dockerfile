# 0G Memory Wallet — Telegram bot (grammY long-polling worker).
# Runs the TypeScript entrypoint directly via tsx.
FROM node:22-slim

WORKDIR /app

# Install dependencies (includes tsx, which runs src/index.ts).
# NODE_ENV is intentionally unset here so devDependencies (tsx, typescript) install.
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY . .

ENV NODE_ENV=production

# Long-polling worker — no ports to expose.
CMD ["npm", "start"]
