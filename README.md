# Hyper-Pi

Decentralized control plane for [pi](https://github.com/badlogic/pi-coding-agent) coding agents.

**pi-socket** · **hypivisor** · **Pi-DE**

---

## Components

| Component | Tech | Purpose |
|-----------|------|---------|
| [pi-socket](pi-socket/) | TypeScript (pi extension) | Exposes each pi CLI via WebSocket |
| [hypivisor](hypivisor/) | Rust (Axum + Tokio) | Central registry daemon |
| [Pi-DE](pi-de/) | React + Vite + TypeScript | Web dashboard |

## Quick Start

### 1. Build pi-socket

```bash
cd pi-socket
npm install
npm run build
# Install globally for pi:
cp -r dist ~/.pi/agent/extensions/pi-socket/
cp package.json ~/.pi/agent/extensions/pi-socket/
cd ~/.pi/agent/extensions/pi-socket && npm install --production
```

### 2. Start hypivisor

```bash
cd hypivisor
cargo run
# Listens on ws://0.0.0.0:31415/ws
```

### 3. Start Pi-DE

```bash
cd pi-de
npm install
npm run dev
# Opens http://localhost:5173
```

### 4. Run pi (in any project directory)

```bash
cd ~/my-project
pi
# pi-socket auto-loads, registers with hypivisor, appears in Pi-DE
```

## Authentication

Set `HYPI_TOKEN` on all processes for optional pre-shared key auth:

```bash
export HYPI_TOKEN="your-secret"
```

For Pi-DE, set `VITE_HYPI_TOKEN` in a `.env` file or environment.

## Architecture

See [specs/](specs/) for the full design:

- [Vision](specs/vision.md) — project philosophy
- [Requirements](specs/requirements.md) — 60+ requirements
- [Design](specs/design.md) — architecture, protocols, reference implementations

## License

MIT
