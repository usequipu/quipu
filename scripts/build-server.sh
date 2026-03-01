#!/bin/bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/../server" && pwd)"
OUT_DIR="$SERVER_DIR/bin"

echo "Building Go server for all platforms..."

# Clean previous builds
rm -rf "$OUT_DIR"

# Build from within the server directory (where go.mod lives)
cd "$SERVER_DIR"

# Windows x64
echo "  -> windows/amd64"
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "$OUT_DIR/win/quipu-server.exe" .

# Linux x64
echo "  -> linux/amd64"
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "$OUT_DIR/linux/quipu-server" .

echo "Done. Binaries in $OUT_DIR/"
ls -lhR "$OUT_DIR"
