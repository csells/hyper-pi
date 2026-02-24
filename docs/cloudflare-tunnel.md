# Cloudflare Tunnel Setup for Hyper-Pi

This guide explains how to set up a Cloudflare tunnel to access the hypivisor and Pi-DE from mobile devices on different networks.

## Prerequisites

- **cloudflared CLI:** Install via Homebrew (macOS) or your package manager
  ```bash
  brew install cloudflare/cloudflare/cloudflared
  ```

- **Cloudflare Account:** Free tier works fine. Sign up at [cloudflare.com](https://cloudflare.com) if you don't have one.

## Quick Tunnel (No Account Setup Required)

For temporary access without configuring a persistent tunnel:

```bash
cloudflared tunnel --url http://localhost:31415
```

This creates a temporary public URL with a random `*.trycloudflare.com` subdomain. The tunnel is active only while the command runs.

**Example output:**
```
Your quick Tunnel has been created! Visit it at (it'll be live for 24hrs):
https://random-name-1234.trycloudflare.com
```

Use this URL directly in your mobile browser. No configuration needed.

## Named Tunnel Setup (Persistent)

For a more reliable setup with a persistent tunnel configuration:

### 1. Create the Tunnel

```bash
cloudflared tunnel create hyper-pi
```

This creates a tunnel named `hyper-pi` and saves credentials to `~/.cloudflared/`.

### 2. Configure Ingress Rules

Create or edit `~/.cloudflared/config.yml`:

```yaml
tunnel: hyper-pi
credentials-file: /Users/YOUR_USERNAME/.cloudflared/hyper-pi.json

ingress:
  # Hypivisor registry and agent proxy relay
  - hostname: hypi.example.com
    service: http://localhost:31415
  
  # Pi-DE dev server (Vite)
  - hostname: pi-de.example.com
    service: http://localhost:5180
  
  # Catch-all (optional, for testing)
  - service: http_status:404
```

Replace `hypi.example.com` and `pi-de.example.com` with domains you control (or use your Cloudflare managed domain).

### 3. Start the Tunnel

```bash
cloudflared tunnel run hyper-pi
```

The tunnel stays active until you stop the command.

## Pi-DE Configuration

When accessing Pi-DE through a Cloudflare tunnel:

1. **Use HTTPS:** Cloudflare tunnels always use HTTPS. In your browser, navigate to `https://pi-de.example.com`.

2. **Set Hypivisor Port:** Since the tunnel uses port 443 (HTTPS), configure Pi-DE to connect to the hypivisor at the tunnel hostname:
   ```bash
   VITE_HYPIVISOR_PORT=443 npm run dev
   ```

3. **WebSocket Support:** Cloudflare tunnels support WebSocket upgrades natively. The hypivisor's proxy relay (forwarding requests from Pi-DE to agent pi-socket WebSockets) works identically over a tunnel.

## Security

### CRITICAL: Set HYPI_TOKEN

**Always set the `HYPI_TOKEN` environment variable when exposing the hypivisor via tunnel:**

```bash
HYPI_TOKEN=your-secret-token hypivisor
```

**Why:** Cloudflare tunnels provide transport encryption (TLS), but they do NOT provide application-level authentication. `HYPI_TOKEN` is your application's authentication layer. Without it, anyone who finds your tunnel URL can access the hypivisor and spawn agents.

On Pi-DE, set the corresponding client token:

```bash
VITE_HYPI_TOKEN=your-secret-token npm run dev
```

Both sides must use the same token.

## Mobile Testing Workflow

1. **Start the hypivisor locally** (with HYPI_TOKEN):
   ```bash
   HYPI_TOKEN=dev-token hypivisor
   ```

2. **Start Pi-DE dev server**:
   ```bash
   VITE_HYPIVISOR_PORT=443 VITE_HYPI_TOKEN=dev-token npm run dev
   ```

3. **Start the tunnel** (in another terminal):
   ```bash
   cloudflared tunnel run hyper-pi
   ```
   Or for a quick tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:31415
   ```

4. **Open on mobile:** Navigate to the tunnel URL in your phone's browser. Pi-DE will connect to the hypivisor through the tunnel.

## Troubleshooting

### "Connection refused" errors
- Verify hypivisor is running on `localhost:31415`
- Verify Pi-DE dev server is running on `localhost:5180`
- Check that `VITE_HYPIVISOR_PORT=443` is set when running Pi-DE via tunnel

### WebSocket disconnections
- Ensure `HYPI_TOKEN` matches on both hypivisor and Pi-DE
- Check browser console for CORS or auth errors
- Cloudflare tunnels natively support WebSocket — no special config needed

### 403 / Auth errors
- Verify `HYPI_TOKEN` environment variable is set on the hypivisor
- Verify `VITE_HYPI_TOKEN` matches in Pi-DE
- Tokens are case-sensitive

## References

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [cloudflared CLI Reference](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/)
