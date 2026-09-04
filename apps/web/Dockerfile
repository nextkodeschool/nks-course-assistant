# Build context is the repository root. See docker-compose.yml.

# ---- build ----------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /src

# package.json first, so npm ci is only rerun when dependencies change.
COPY apps/web/package.json ./
RUN npm install

COPY apps/web/ ./
RUN npm run build

# ---- serve ----------------------------------------------------------------
# Only the built files reach this stage. node, npm and node_modules do not.
FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 8080
