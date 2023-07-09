FROM node:18-bookworm-slim

RUN : "echo install packages" \
    && apt update \
    && apt install -y less man-db sudo g++ python3 git ffmpeg


ARG USERNAME=node
RUN : "echo setting user" \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

ENV DEVCONTAINER=true

USER $USERNAME
