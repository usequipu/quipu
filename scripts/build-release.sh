#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== Quipu Release Build ==="

echo ""
echo "1/3 Building Go server..."
bash scripts/build-server.sh

echo ""
echo "2/3 Building Vite frontend..."
npm run build

echo ""
echo "3/3 Packaging Electron app..."
# Build for the specified target, or default to current platform
TARGET="${1:-}"
if [ -n "$TARGET" ]; then
    npx electron-builder --$TARGET
else
    npx electron-builder
fi

echo ""
echo "=== Build complete ==="
echo "Output in release/"
ls -lh release/ 2>/dev/null || echo "(no output found)"
