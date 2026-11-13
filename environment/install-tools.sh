#!/bin/sh
# Run as the guest administrator. No credentials or model calls.
set -eu
version=1.18.34
expected=bbdb3f00c2c51e42e315525233151309724226a8776da8e9145e3b0fa3d5310f
if [ -x /usr/local/bin/opencode ] && [ "$(/usr/local/bin/opencode --version)" = "$version" ]; then exit 0; fi
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
curl --fail --location --silent --show-error "https://github.com/anomalyco/opencode/releases/download/v$version/opencode-linux-arm64.tar.gz" -o "$scratch/opencode.tar.gz"
printf '%s  %s\n' "$expected" "$scratch/opencode.tar.gz" | sha256sum --check -
tar -xzf "$scratch/opencode.tar.gz" -C "$scratch"
install -m 0755 "$scratch/opencode" /usr/local/bin/opencode
/usr/local/bin/opencode --version
