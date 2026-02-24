#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

# ── Load .env ──────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: No .env file. Run setup first: bash .pi/skills/cf-tunnel/scripts/setup.sh" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# ── Validate ───────────────────────────────────────────────────
missing=()
for var in CF_TUNNEL_NAME PIDE_HOSTNAME HYPI_HOSTNAME HYPI_TOKEN; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing .env variables: ${missing[*]}" >&2
  exit 1
fi

# ── Find credentials ──────────────────────────────────────────
if [[ -z "${CF_CREDENTIALS_FILE:-}" ]]; then
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$CF_TUNNEL_NAME" | awk '{print $1}')
  CF_CREDENTIALS_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
fi

if [[ ! -f "$CF_CREDENTIALS_FILE" ]]; then
  echo "ERROR: Credentials file not found: $CF_CREDENTIALS_FILE" >&2
  echo "Run setup first: bash .pi/skills/cf-tunnel/scripts/setup.sh" >&2
  exit 1
fi

# ── Generate cloudflared config ────────────────────────────────
CF_CONFIG="/tmp/hyper-pi-tunnel.yml"
cat > "$CF_CONFIG" <<YAML
tunnel: $CF_TUNNEL_NAME
credentials-file: $CF_CREDENTIALS_FILE

ingress:
  - hostname: $PIDE_HOSTNAME
    service: http://localhost:5180
  - hostname: $HYPI_HOSTNAME
    service: http://localhost:31415
  - service: http_status:404
YAML

echo "==> Generated config: $CF_CONFIG"

# ── Tmux session ──────────────────────────────────────────────
SESSION=$(basename "$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)" || basename "$PROJECT_ROOT")

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -n cf-tunnel
else
  if tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -q "^cf-tunnel$"; then
    echo "==> Killing existing tunnel window..."
    tmux send-keys -t "$SESSION:cf-tunnel" C-c 2>/dev/null || true
    sleep 1
    tmux kill-window -t "$SESSION:cf-tunnel" 2>/dev/null || true
    sleep 1
  fi
  tmux new-window -t "$SESSION" -n cf-tunnel
fi

tmux send-keys -t "$SESSION:cf-tunnel" "cloudflared tunnel --config $CF_CONFIG run $CF_TUNNEL_NAME" Enter

echo "==> Tunnel starting in tmux window '$SESSION:cf-tunnel'..."

# ── Wait for tunnel to connect ─────────────────────────────────
echo "==> Waiting for tunnel connection..."
for i in $(seq 1 30); do
  if tmux capture-pane -p -t "$SESSION:cf-tunnel" -S -20 2>/dev/null | grep -q "Registered tunnel connection"; then
    echo "==> Tunnel connected!"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "WARNING: Tunnel may not be connected yet. Check: tmux capture-pane -p -t '$SESSION:cf-tunnel' -S -20" >&2
  fi
  sleep 1
done

# ── Restart Pi-DE with VITE_HYPIVISOR_URL ──────────────────────
HYPI_WS_URL="wss://$HYPI_HOSTNAME"

# Kill existing Pi-DE if running on 5180
PIDE_PID=$(lsof -ti TCP:5180 -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$PIDE_PID" ]]; then
  echo "==> Stopping existing Pi-DE (PID $PIDE_PID)..."
  kill "$PIDE_PID" 2>/dev/null || true
  sleep 2
fi

if tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -q "^pi-de$"; then
  tmux send-keys -t "$SESSION:pi-de" C-c 2>/dev/null || true
  sleep 1
else
  tmux new-window -t "$SESSION" -n pi-de
fi

tmux send-keys -t "$SESSION:pi-de" "cd $PROJECT_ROOT/pi-de && VITE_HYPIVISOR_URL=$HYPI_WS_URL VITE_HYPI_TOKEN=$HYPI_TOKEN npm run dev" Enter

echo "==> Pi-DE starting with VITE_HYPIVISOR_URL=$HYPI_WS_URL"

# ── Wait for Pi-DE ─────────────────────────────────────────────
echo "==> Waiting for Pi-DE dev server..."
for i in $(seq 1 15); do
  if lsof -ti TCP:5180 -sTCP:LISTEN &>/dev/null; then
    echo "==> Pi-DE ready on :5180"
    break
  fi
  sleep 1
done

# ── Summary ────────────────────────────────────────────────────
cat <<EOF

✅ Tunnel is live!

  Pi-DE:     https://$PIDE_HOSTNAME
  Hypivisor: wss://$HYPI_HOSTNAME
  Token:     (set)

  tmux windows:
    $SESSION:cf-tunnel  — cloudflared
    $SESSION:pi-de      — Vite dev server

  Stop with: bash .pi/skills/cf-tunnel/scripts/stop.sh
EOF
