# check=skip=InvalidDefaultArgInFrom
# base image は docker-bake.json から渡す。digest で固定した参照は docker-bake.json にまとめてある。
# BUILDER_IMAGE は distro に依存しない JS の成果物（client/dist、dist）を作る stage の base で、
# 全 target で同じ値にする。同じ値なら 1 回の bake でこれらの stage は 1 回だけ build され、各 image が共有する。
# NODE_IMAGE は native addon を含む依存と最終 stage の base で、distro ごとに違う。
ARG BUILDER_IMAGE
ARG NODE_IMAGE

FROM ${BUILDER_IMAGE} AS client-builder
WORKDIR /app/client
COPY client/package*.json /app/client/
# npm が取得した package は cache mount（/root/.npm）に残し、手元にある分を取得し直さない。cache mount の
# 中身は image にも層にも入らない。npm ci はどれも同じ cache mount を sharing=locked で使い、1 つずつ実行する。
# 後から実行する npm ci は、先に取得された package を使うので、同じ package を 2 度取得しない。
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --loglevel=info \
    --fetch-retries=10 --fetch-retry-mintimeout=100000 --fetch-retry-maxtimeout=600000
# client の bundle は client フォルダーの中だけで完結するので、client フォルダーだけをコピーする。
# client 以外の変更では bundle を作り直さない。
COPY client/ /app/client/
# image build は組み立てだけを行う。lint、typecheck、unit test は CI の gate が実行する。
RUN npm run bundle --loglevel=info

# compile（tsc）は native addon を使わないので、install script を走らせずに入れた依存（devDependencies を
# 含む）で行う。依存は lockfile と package.json だけで決まるので、compile の入力（tsconfig.json、api.d.ts、src）
# は npm ci のあとでコピーし、それらの変更では依存を入れ直さない。
# lockfile どおりに入れる。`npm install` は package.json とずれていれば解決し直すため、
# 公開する image の依存が lockfile と一致する保証がない。
# 同じく組み立てだけを行う。lint、format、静的検査は CI の gate が実行する。
FROM ${BUILDER_IMAGE} AS server-builder
WORKDIR /app
COPY package*.json /app/
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --ignore-scripts --loglevel=info \
    --fetch-retries=10 --fetch-retry-mintimeout=100000 --fetch-retry-maxtimeout=600000
COPY tsconfig.json api.d.ts /app/
COPY src/ /app/src/
RUN npm run compile

# 実行時の依存。サーバーは better-sqlite3 や fs-ext のようなプラットフォーム依存のネイティブ・アドオンを
# 含んでいるので、distro と TARGETPLATFORM ごとに build しなければならない。
FROM ${NODE_IMAGE} AS server-prod-deps
ARG DISTRO
# native addon の build に要る compiler と python3 を入れる。package manager の cache は cache mount に置き、
# OS の層を作り直すときに取得し直さない。debian の base image の docker-clean は install のあとで .deb を
# 消すので外す。一覧の無い cache mount で install だけが走らないよう、update と install は同じ RUN で行う。
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/etc/apk/cache \
    case "$DISTRO" in \
      debian) rm -f /etc/apt/apt.conf.d/docker-clean \
        && apt-get update \
        && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends g++ make python3 ;; \
      alpine) apk add --update-cache g++ make pkgconf python3 ;; \
      *) echo "unknown DISTRO: $DISTRO" >&2; exit 1 ;; \
    esac
WORKDIR /app
COPY package*.json /app/
ENV DOCKER="YES"
# fs-ext の build で node-gyp は、Node の header を Node 自身が示す取得先
# （process.release.headersUrl）から download する。回線が遅いとこの download が
# ETIMEDOUT で失敗する。base image は同じ版の header を /usr/local/include/node に
# 持っているので、それを使わせて download そのものを無くす。
# 指定は npm_config_ 接頭辞ではなく npm_package_config_node_gyp_ の形にする。node-gyp の
# README は npm_config_ 接頭辞を npm@11 で deprecated、npm@12 で削除としており、この形が推奨。
ENV npm_package_config_node_gyp_nodedir=/usr/local
# image に要るのは実行時の依存だけなので、開発用の package（devDependencies）は入れない。
# 最終 stage はこの stage の node_modules だけを受け取り、compiler などの OS の package は image に入らない。
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --loglevel=info \
    --fetch-retries=10 --fetch-retry-mintimeout=100000 --fetch-retry-maxtimeout=600000

FROM ${NODE_IMAGE}
LABEL maintainer="l3tnun"
# 実行時に読むファイル（api.yml、img、config の template など）は、一覧を持たずに build context ごと
# コピーする。一覧を持つと、ファイルを追加するたびに Dockerfile の変更が要る。node_modules は
# .dockerignore で除かれるので、依存と build の成果物はこのあとで各 stage から重ねる。
COPY . /app/
COPY --from=server-prod-deps /app/node_modules /app/node_modules/
COPY --from=server-builder /app/dist /app/dist/
COPY --from=client-builder /app/client/dist /app/client/dist/
EXPOSE 8888
WORKDIR /app
ENTRYPOINT ["npm"]
CMD ["start"]
