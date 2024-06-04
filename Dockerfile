# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun as base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# run the app
USER bun
EXPOSE 8080/tcp

ENV LISTEN_ADDR=0.0.0.0
ENV LISTEN_PORT=8080

ENTRYPOINT [ "bun", "run", "index.ts" ]