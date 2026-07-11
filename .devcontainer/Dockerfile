FROM mcr.microsoft.com/devcontainers/typescript-node:4-24-bullseye

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
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt bullseye-pgdg main" \
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
        python3-pip; \
    pip3 install --no-cache-dir pgcli; \
    rm -rf /var/lib/apt/lists/*