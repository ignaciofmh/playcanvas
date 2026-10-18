#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]] || [[ "$(uname -m)" != arm64 ]]; then
  echo 'Este instalador es para macOS Apple Silicon. Para otro equipo configura FFMPEG_PATH, FFPROBE_PATH, COLMAP_PATH y BRUSH_PATH según README.md.' >&2
  exit 1
fi
if ! command -v brew >/dev/null; then
  echo 'Instala Homebrew desde https://brew.sh y vuelve a ejecutar npm run setup.' >&2
  exit 1
fi
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install ffmpeg colmap
brush_dir='.tools/brush'
brush_binary="$brush_dir/brush-app-aarch64-apple-darwin/brush_app"
if [[ ! -x "$brush_binary" ]]; then
  mkdir -p "$brush_dir"
  archive_url='https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-aarch64-apple-darwin.tar.xz'
  curl -fL "$archive_url" -o "$brush_dir/archive.tar.xz"
  curl -fsSL "$archive_url.sha256" -o "$brush_dir/archive.sha256"
  python3 - <<'PY'
import hashlib, pathlib
p = pathlib.Path('.tools/brush')
assert hashlib.sha256((p/'archive.tar.xz').read_bytes()).hexdigest() == (p/'archive.sha256').read_text().split()[0], 'Checksum de Brush incorrecto'
print('Checksum de Brush verificado')
PY
  tar -xJf "$brush_dir/archive.tar.xz" -C "$brush_dir"
fi
"$brush_binary" --version
echo 'Herramientas instaladas. Ejecuta npm install y npm start con Node.js 22 o superior.'
