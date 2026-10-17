FROM postgres:18-alpine

# Update the release and source archive checksum together.
ARG PGVECTOR_VERSION=0.8.7
ARG PGVECTOR_SHA256=cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85

RUN set -eux; \
    apk add --no-cache --virtual .pgvector-build-deps build-base curl; \
    curl --fail --location --silent --show-error \
        "https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v${PGVECTOR_VERSION}" \
        -o /tmp/pgvector.tar.gz; \
    echo "${PGVECTOR_SHA256}  /tmp/pgvector.tar.gz" | sha256sum -c -; \
    mkdir /tmp/pgvector; \
    tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1; \
    cd /tmp/pgvector; \
    # Avoid host-specific CPU flags and the optional LLVM build toolchain.
    make -j "$(nproc)" OPTFLAGS="" with_llvm=no; \
    make install OPTFLAGS="" with_llvm=no; \
    install -Dm644 LICENSE /usr/local/share/doc/pgvector/LICENSE; \
    cd /; \
    rm -rf /tmp/pgvector /tmp/pgvector.tar.gz; \
    apk del --no-network .pgvector-build-deps
