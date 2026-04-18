#!/usr/bin/env bash
# Deploy iStickMD to the Pi.
# Usage: ./scripts/deploy.sh [host]
set -euo pipefail

HOST="${1:-dork@192.168.8.119}"
REMOTE_APP="/home/dork/istickmd"
REMOTE_NOTES="/home/dork/notes"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$LOCAL_DIR"

echo "→ Building frontend locally…"
~/.bun/bin/bun run build

echo "→ Ensuring remote directories…"
ssh "$HOST" "mkdir -p $REMOTE_APP $REMOTE_NOTES"

echo "→ Syncing app to $HOST:$REMOTE_APP…"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude notes \
  --exclude .DS_Store \
  ./ "$HOST:$REMOTE_APP/"

echo "→ Installing production deps on Pi…"
ssh "$HOST" "cd $REMOTE_APP && ~/.bun/bin/bun install --production"

echo "→ Installing systemd unit…"
ssh "$HOST" "sudo cp $REMOTE_APP/scripts/istickmd.service /etc/systemd/system/istickmd.service && sudo systemctl daemon-reload && sudo systemctl enable istickmd.service && sudo systemctl restart istickmd.service"

echo "→ Waiting for service…"
sleep 2
ssh "$HOST" "systemctl is-active istickmd && curl -sf http://localhost:3000/api/health" || {
  echo "✗ service check failed — logs:"
  ssh "$HOST" "journalctl -u istickmd -n 30 --no-pager"
  exit 1
}

echo
echo "✓ Deployed. Open http://192.168.8.119:3000 on your LAN."
