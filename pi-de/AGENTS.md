# Pi-DE

React + Vite + TypeScript web dashboard for Hyper-Pi. Three-pane layout: Roster (left), Chat Stage (center), Inspector (right).

## Commands

```bash
npm install     # Install dependencies
npm run dev     # Dev server on :5173
npm run build   # Production build
npm run lint    # Type-check
```

## Environment

- `VITE_HYPI_TOKEN` — pre-shared key matching hypivisor's HYPI_TOKEN
- `VITE_HYPIVISOR_PORT` — hypivisor port (default: 31415)
