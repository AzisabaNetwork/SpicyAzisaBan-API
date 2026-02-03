# --- Build Stage ---
FROM node:22 AS builder
RUN corepack enable && corepack prepare yarn@4.12.0 --activate
WORKDIR /app
COPY . .
RUN yarn install

# pre-compile typescript
RUN yarn build

# --- Run Stage ---
FROM node:22
WORKDIR /app

# copy essentials
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .

# set production env
ENV NODE_ENV=production

# run pre-compiled javascript file
CMD ["node", "./dist/index.js"]

