#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

SESSION=$(basename "$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)" || basename "$PROJECT_ROOT")

# ── Load .env for hostnames ────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

# ── Tunnel status ──────────────────────────────────────────────
echo "=== CF Tunnel ==="
if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -q "^cf-tunnel$"; then
  echo "Status: RUNNING (tmux $SESSION:cf-tunnel)"
  # Check for connection
  if tmux capture-pane -p -t "$SESSION:cf-tunnel" -S -5 2>/dev/null | grep -q "Registered tunnel"; then
    echo "Connection: ESTABLISHED"
  else
    echo "Connection: check 'tmux capture-pane -p -t $SESSION:cf-tunnel -S -20'"
  fi
else
  echo "Status: STOPPED"
fi

if [[ -n "${PIDE_HOSTNAME:-}" ]]; then
  echo "Pi-DE URL: https://$PIDE_HOSTNAME"
fi
if [[ -n "${HYPI_HOSTNAME:-}" ]]; then
  echo "Hypivisor URL: wss://$HYPI_HOSTNAME"
fi

# ── Pi-DE status ───────────────────────────────────────────────
echo ""
echo "=== Pi-DE Dev Server ==="
PIDE_PID=$(lsof -ti TCP:5180 -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$PIDE_PID" ]]; then
  echo "Status: RUNNING (PID $PIDE_PID, port 5180)"
else
  echo "Status: STOPPED"
fi

# ── Hypivisor status ──────────────────────────────────────────
echo ""
echo "=== Hypivisor ==="
HYPI_PID=$(lsof -ti TCP:31415 -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$HYPI_PID" ]]; then
  echo "Status: RUNNING (PID $HYPI_PID, port 31415)"
else
  echo "Status: STOPPED"
fi
