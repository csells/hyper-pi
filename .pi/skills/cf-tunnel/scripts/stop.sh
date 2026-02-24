#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

SESSION=$(basename "$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)" || basename "$PROJECT_ROOT")

# ── Kill tunnel ────────────────────────────────────────────────
if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -q "^cf-tunnel$"; then
  echo "==> Stopping tunnel..."
  tmux send-keys -t "$SESSION:cf-tunnel" C-c 2>/dev/null || true
  sleep 2
  tmux kill-window -t "$SESSION:cf-tunnel" 2>/dev/null || true
  echo "==> Tunnel stopped."
else
  echo "==> No tunnel window found."
fi

# ── Restart Pi-DE without tunnel env vars ──────────────────────
if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -q "^pi-de$"; then
  echo "==> Restarting Pi-DE without tunnel config..."
  tmux send-keys -t "$SESSION:pi-de" C-c 2>/dev/null || true
  sleep 1
  tmux send-keys -t "$SESSION:pi-de" "cd $PROJECT_ROOT/pi-de && npm run dev" Enter
  echo "==> Pi-DE restarted (local-only mode)."
else
  echo "==> No Pi-DE window found."
fi

echo "✅ Tunnel stopped. Pi-DE running in local-only mode."
