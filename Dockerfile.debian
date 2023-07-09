# クライアントはプラットフォーム依存のコードを含まないため、BUILDPLATFORMでビルドした結果を
# 全てのTARGETPLATFORMで再利用できる。これによりビルド時間を短縮できる。
FROM --platform=$BUILDPLATFORM node:18-bookworm AS client-builder
COPY client/package*.json /app/client/
WORKDIR /app/client
# どこで時間が掛かっているのか確認できるようにログレベルを変更。
RUN npm install --no-save --loglevel=info
# clientフォルダー外にビルドに必要なファイルが存在するため、全てコピーする。
COPY . /app/
RUN npm run build --loglevel=info

# サーバーはsqlite3のようなプラットフォーム依存のネイティブ・アドオンを含んでいる。そのため、各
# TARGETPLATFORMごとにソースをビルドしなければならない。BUILDPLATFORM以外のTARGETPLATFORMでは、QEMU
# 上でnpmコマンドを実行することになるため、どうしても時間が掛かる。
#
# `npm install`時にネイティブ・アドオンをクロスビルドできればビルド時間を短縮できるが、現時点では明
# 確な手順は存在しない。https://github.com/mapbox/node-pre-gyp/issues/348を見ればそれが分かる。
#
# `npm run build-server`はプラットフォーム依存処理を含まないため、これをBUILDPLATFORMで実行すること
# でビルド時間をさらに短縮可能だが、手順が煩雑で面倒なので現時点では行っていない。
FROM node:18-bookworm AS server-builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update
RUN apt-get install -y build-essential python3
WORKDIR /app
COPY package*.json /app/
ENV DOCKER="YES"
RUN npm install --no-save --loglevel=info
# 最終イメージのサイズ削減のため、すべてコピーした後でclientフォルダーを削除。clientフォルダー以外
# をコピーする方法は，ファイルが追加された場合に変更する必要があるため採用しない。
COPY . .
RUN rm -rf client
RUN npm run build-server --loglevel=info

FROM node:18-bookworm-slim
LABEL maintainer="l3tnun"
COPY --from=server-builder /app /app/
COPY --from=client-builder /app/client /app/client/
EXPOSE 8888
WORKDIR /app
ENTRYPOINT ["npm"]
CMD ["start"]
