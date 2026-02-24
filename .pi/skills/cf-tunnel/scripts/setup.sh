#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

# ── Load .env ──────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<'EOF'
ERROR: No .env file found in the project root.

Create one with:

  CF_TUNNEL_NAME=hyper-pi-yourname
  PIDE_HOSTNAME=pide.yourdomain.com
  HYPI_HOSTNAME=hypi.yourdomain.com
  HYPI_TOKEN=some-secret-token

Then re-run this script.
EOF
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# ── Validate required vars ─────────────────────────────────────
missing=()
for var in CF_TUNNEL_NAME PIDE_HOSTNAME HYPI_HOSTNAME HYPI_TOKEN; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing required .env variables: ${missing[*]}" >&2
  exit 1
fi

# ── Check cloudflared ──────────────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  echo "ERROR: cloudflared not found. Install with: brew install cloudflare/cloudflare/cloudflared" >&2
  exit 1
fi

# ── Step 1: Login (if needed) ──────────────────────────────────
if [[ ! -f ~/.cloudflared/cert.pem ]]; then
  echo "==> Authenticating with Cloudflare (opens browser)..."
  cloudflared tunnel login
else
  echo "==> Already authenticated with Cloudflare."
fi

# ── Step 2: Create tunnel (if needed) ──────────────────────────
if cloudflared tunnel list 2>/dev/null | grep -q "$CF_TUNNEL_NAME"; then
  echo "==> Tunnel '$CF_TUNNEL_NAME' already exists."
else
  echo "==> Creating tunnel '$CF_TUNNEL_NAME'..."
  cloudflared tunnel create "$CF_TUNNEL_NAME"
fi

# ── Step 3: Route DNS ──────────────────────────────────────────
echo "==> Routing DNS for $PIDE_HOSTNAME..."
cloudflared tunnel route dns "$CF_TUNNEL_NAME" "$PIDE_HOSTNAME" 2>&1 || true

echo "==> Routing DNS for $HYPI_HOSTNAME..."
cloudflared tunnel route dns "$CF_TUNNEL_NAME" "$HYPI_HOSTNAME" 2>&1 || true

# ── Step 4: Find credentials file ─────────────────────────────
if [[ -z "${CF_CREDENTIALS_FILE:-}" ]]; then
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$CF_TUNNEL_NAME" | awk '{print $1}')
  CF_CREDENTIALS_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
fi

if [[ ! -f "$CF_CREDENTIALS_FILE" ]]; then
  echo "WARNING: Credentials file not found at $CF_CREDENTIALS_FILE" >&2
  echo "You may need to set CF_CREDENTIALS_FILE in .env" >&2
else
  echo "==> Credentials: $CF_CREDENTIALS_FILE"
fi

# ── Done ───────────────────────────────────────────────────────
cat <<EOF

✅ Setup complete!

  Tunnel:    $CF_TUNNEL_NAME
  Pi-DE:     https://$PIDE_HOSTNAME
  Hypivisor: https://$HYPI_HOSTNAME

Start the tunnel with:  bash .pi/skills/cf-tunnel/scripts/start.sh
EOF
