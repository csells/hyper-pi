---
name: cf-tunnel
description: Start/stop a Cloudflare tunnel for remote access to Pi-DE and the hypivisor. Use when the user says "start tunnel", "tunnel up", "open tunnel", "remote access", "mobile access", or wants to access Pi-DE from a phone or another machine.
---

# Cloudflare Tunnel for Hyper-Pi

Boots a named CF tunnel that exposes Pi-DE and the hypivisor on stable,
bookmarkable hostnames with token auth.

## Prerequisites

- `cloudflared` CLI installed (`brew install cloudflare/cloudflare/cloudflared`)
- A Cloudflare account with a domain (free tier works)
- One-time setup completed (see Setup below)

## Configuration

All per-developer config lives in the project root `.env` (already gitignored).
Required variables:

```
CF_TUNNEL_NAME=hyper-pi-yourname
PIDE_HOSTNAME=pide.yourdomain.com
HYPI_HOSTNAME=hypi.yourdomain.com
HYPI_TOKEN=your-secret-token
```

Optional (auto-discovered if omitted):
```
CF_CREDENTIALS_FILE=~/.cloudflared/<tunnel-id>.json
```

## One-Time Setup

If the developer has never set up a tunnel, run the setup script:

```bash
bash .pi/skills/cf-tunnel/scripts/setup.sh
```

This will:
1. Run `cloudflared tunnel login` (opens browser for Cloudflare auth)
2. Create the named tunnel from `CF_TUNNEL_NAME`
3. Route DNS for both `PIDE_HOSTNAME` and `HYPI_HOSTNAME`
4. Print confirmation

## Daily Usage

### Start tunnel

```bash
bash .pi/skills/cf-tunnel/scripts/start.sh
```

Starts cloudflared + restarts Pi-DE dev server with the correct
`VITE_HYPIVISOR_URL` in a tmux session. Verifies both endpoints respond
before reporting success.

### Stop tunnel

```bash
bash .pi/skills/cf-tunnel/scripts/stop.sh
```

Kills the tunnel and restarts Pi-DE without the tunnel env var.

### Status

```bash
bash .pi/skills/cf-tunnel/scripts/status.sh
```

## Verification

After `start.sh`, always verify with surf:
1. `surf tab.new https://<PIDE_HOSTNAME>` — should show Pi-DE
2. Check console for errors
3. Close the test tab
