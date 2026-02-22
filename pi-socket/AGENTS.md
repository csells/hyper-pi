# pi-socket

TypeScript extension for the pi coding agent. Exposes a local WebSocket server and registers with the hypivisor.

Uses real pi ExtensionAPI — see `specs/design.md` for the correct event names and API surface. Do not use hallucinated APIs like `pi.chat.send()` or `pi.on('message:delta')`.

## Commands

```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
npm run lint   # Type-check without emitting
```

## Installation

Copy or symlink the built output to `~/.pi/agent/extensions/pi-socket/` for global use.
