FROM imbios/bun-node

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install

COPY . .

EXPOSE 9000

ENTRYPOINT ["bun", "run", "index.ts"]