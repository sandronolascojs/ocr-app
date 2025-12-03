# Dockerfile
FROM node:22-alpine

# 1) Herramientas básicas
RUN apk add --no-cache bash

# 2) Directorios base
RUN mkdir -p /app /mnt

WORKDIR /app

# 3) Copiamos sólo lo necesario para instalar dependencias
COPY package.json pnpm-lock.yaml ./

# 4) Instalamos pnpm vía corepack como root y deps del proyecto (sin scripts)
RUN corepack enable pnpm \
 && pnpm install --frozen-lockfile --ignore-scripts

# 5) Copiamos el resto del código
COPY . .

# 6) Dar permisos al usuario node para /app y /mnt
RUN chown -R node:node /app /mnt

# 7) A partir de acá corremos como node (no root)
USER node

EXPOSE 3000

# 8) Next dev con pnpm
CMD ["pnpm", "dev"]