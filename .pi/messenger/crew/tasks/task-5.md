# Cloudflare tunnel setup documentation

Document how to set up a Cloudflare tunnel so Pi-DE and the hypivisor can be accessed from mobile devices on different networks.

**Files to create:**
- `docs/cloudflare-tunnel.md` (new, ~80 lines) — Setup guide

**Content:**
1. **Prerequisites:** `cloudflared` CLI installed (`brew install cloudflare/cloudflare/cloudflared`), Cloudflare account (free tier works)
2. **Quick tunnel (no account needed):** `cloudflared tunnel --url http://localhost:31415` — creates a temporary public URL for the hypivisor. Note: this gives you a random `*.trycloudflare.com` subdomain.
3. **Named tunnel setup:** `cloudflared tunnel create hyper-pi`, configure `~/.cloudflared/config.yml` with ingress rules for both the hypivisor (port 31415) and Pi-DE dev server (port 5180)
4. **Pi-DE configuration:** When accessing via tunnel, Pi-DE connects to the hypivisor at the tunnel's hostname. Set `VITE_HYPIVISOR_PORT` to 443 (tunnel uses HTTPS). Note that WebSocket upgrades work over Cloudflare tunnels natively.
5. **Security warning:** ALWAYS set `HYPI_TOKEN` env var on the hypivisor when exposing via tunnel. The tunnel provides transport encryption (TLS) but `HYPI_TOKEN` provides application-level authentication.
6. **WebSocket note:** Cloudflare tunnels support WebSocket protocol natively — no special configuration needed. The proxy relay through the hypivisor works identically whether local or tunneled.
7. **Mobile testing workflow:** Start hypivisor + Pi-DE locally, run `cloudflared tunnel`, open the tunnel URL on your phone's browser.

**Acceptance criteria:**
- Doc covers quick tunnel and named tunnel setups
- Includes security warnings about HYPI_TOKEN
- References existing env vars (VITE_HYPIVISOR_PORT, VITE_HYPI_TOKEN, HYPI_TOKEN)
- Includes example cloudflared config.yml
- No code changes required
