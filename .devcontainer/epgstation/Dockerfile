FROM node:24-bookworm-slim

RUN : "echo install packages" \
    && apt update \
    && apt install -y less man-db sudo g++ python3 git ffmpeg locales procps


ARG USERNAME=node
RUN : "echo setting user" \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

RUN : "echo setting locale" \
    && sed -i -e 's/# \(ja_JP.UTF-8\)/\1/' /etc/locale.gen \
    && locale-gen \
    && update-locale LANG=ja_JP.UTF-8

ENV LANG=ja_JP.UTF-8
ENV DEVCONTAINER=true

USER $USERNAME
