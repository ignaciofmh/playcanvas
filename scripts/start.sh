#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  node_bin=""
  for candidate in "$HOME"/.nvm/versions/node/v22.*/bin/node /opt/homebrew/bin/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
      node_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$node_bin" ]]; then
  echo 'Se necesita Node.js 22 o superior. Usa nvm install 22 y npm install.' >&2
  exit 1
fi
export PATH="$(dirname "$node_bin"):/opt/homebrew/bin:$PATH"
exec "$node_bin" server.mjs "$@"
