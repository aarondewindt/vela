FROM eclipse-temurin:17.0.18_8-jdk-jammy AS java
FROM mcr.microsoft.com/devcontainers/typescript-node:4-24-trixie

# Trixie does not ship JDK 17. Copy a versioned, glibc-compatible Temurin JDK.
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/home/node/.gradle
ENV PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

# Install developer utilities and PostgreSQL 18 CLI tools.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg; \
    install -d -m 0755 /usr/share/keyrings; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ripgrep \
        libc-bin \
        iputils-ping \
        dnsutils \
        netcat-openbsd \
        mtr-tiny \
        traceroute \
        jq \
        iproute2 \
        nmap \
        postgresql-client-18 \
        pgcli \
        python3-pip \
        unzip \
        libstdc++6 \
        zlib1g \
        libfontconfig1; \
    rm -rf /var/lib/apt/lists/*

# Official Linux Android binaries require x86-64. SDK contents live in a cached
# image layer, never under a volume that could hide them on later rebuilds.
ARG ANDROID_COMMAND_TOOLS=13114758
ARG ANDROID_COMMAND_TOOLS_SHA256=7ec965280a073311c339e571cd5de778b9975026cfcbe79f2b1cdcb1e15317ee
ARG ANDROID_PLATFORM_TOOLS=37.0.1
ARG ANDROID_PLATFORM_TOOLS_SHA256=d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1
RUN set -eux; \
    test "$(dpkg --print-architecture)" = amd64; \
    mkdir -p "$ANDROID_HOME/cmdline-tools"; \
    curl -fsSL --retry 3 "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMAND_TOOLS}_latest.zip" -o /tmp/android-tools.zip; \
    echo "$ANDROID_COMMAND_TOOLS_SHA256  /tmp/android-tools.zip" | sha256sum -c -; \
    unzip -q /tmp/android-tools.zip -d "$ANDROID_HOME/cmdline-tools"; \
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"; \
    curl -fsSL --retry 3 "https://dl.google.com/android/repository/platform-tools_r${ANDROID_PLATFORM_TOOLS}-linux.zip" -o /tmp/platform-tools.zip; \
    echo "$ANDROID_PLATFORM_TOOLS_SHA256  /tmp/platform-tools.zip" | sha256sum -c -; \
    unzip -q /tmp/platform-tools.zip -d "$ANDROID_HOME"; \
    rm /tmp/android-tools.zip /tmp/platform-tools.zip; \
    yes | sdkmanager --licenses >/dev/null; \
    sdkmanager 'platforms;android-36' 'build-tools;35.0.0'; \
    mkdir -p /home/node/.gradle /home/node/.android; \
    chown -R node:node "$ANDROID_HOME" /home/node/.gradle /home/node/.android

# Explicit TCP host disables ADB's automatic local daemon startup. ddmlib also
# connects to this loopback relay, which forwards to the Ubuntu Unix socket.
ENV ADB_SERVER_SOCKET=tcp:127.0.0.1:5037
