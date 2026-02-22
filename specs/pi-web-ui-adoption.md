# Pi-DE: Adopt @mariozechner/pi-web-ui Components

Status: Draft
Created: 2026-02-22

---

## Research Findings

### The package is real and published

`@mariozechner/pi-web-ui` exists on npm and in the pi-mono monorepo at `packages/web-ui/`.
It is built with **mini-lit web components** and **Tailwind CSS v4** (NOT React).

- npm: https://www.npmjs.com/package/@mariozechner/pi-web-ui
- GitHub: https://github.com/badlogic/pi-mono/tree/main/packages/web-ui

### What pi-web-ui provides (from npm + GitHub source)

**Components** (`src/components/`):
- `ChatPanel` — High-level chat interface with built-in artifacts panel
- `AgentInterface` — Lower-level chat interface (custom element `<agent-interface>`)
- `MessageList` / `Messages` — Message rendering with streaming support
- `StreamingMessageContainer` — Handles real-time streaming tokens
- `ThinkingBlock` — Shows model thinking/reasoning
- `Input` — Chat input with attachment support
- `MessageEditor` — Edit messages in history
- `AttachmentTile` — PDF, DOCX, XLSX, PPTX, images with preview
- `ConsoleBlock` — Console/tool output rendering
- `ExpandableSection` — Collapsible UI sections
- `SandboxedIframe` — Sandboxed execution for artifacts
- `message-renderer-registry` — Extensible message type rendering

**Dialogs** (`src/dialogs/`):
- `SettingsDialog`, `SessionListDialog`, `ApiKeyPromptDialog`, `ModelSelector`

**Storage** (`src/storage/`):
- `AppStorage`, `IndexedDBStorageBackend`
- `SettingsStore`, `ProviderKeysStore`, `SessionsStore`, `CustomProvidersStore`

**Tools** (`src/tools/`):
- JavaScript REPL, document extraction, artifacts

**Styling:**
- `app.css` — Pre-built Tailwind CSS
- Theme support via `@mariozechner/mini-lit/themes/claude.css`

### What Pi-DE currently does (NO pi-web-ui usage)

Pi-DE is entirely hand-rolled React + custom CSS:
- `package.json` — Only deps: `react`, `react-dom`. Zero pi packages.
- Chat is a `<div className="chat-area">` with `.map()` over `{role, content}` objects
- Raw `white-space: pre-wrap` text — no markdown rendering, no code highlighting
- No thinking block rendering
- No tool execution visualization (just system messages)
- No attachment support
- Theme is CSS custom properties in App.css
- No streaming container — just appending text

### Spec violations

- **R-UI-24:** Pi-DE MUST render the conversation using `ChatPanel` from `@mariozechner/pi-web-ui` — ❌ VIOLATED
- **R-UI-34:** Pi-DE MUST use `@mariozechner/pi-web-ui` components where available — ❌ VIOLATED

---

## Key Architectural Challenge

**pi-web-ui uses mini-lit web components, NOT React.**

The components are Lit-based custom elements (e.g., `<agent-interface>`, `<chat-panel>`).
They expect a local `Agent` instance from `@mariozechner/pi-agent-core`, not a remote WebSocket.

Pi-DE's architecture is:
1. Browser connects to hypivisor via WebSocket (roster/events)
2. Browser connects directly to pi-socket agent via WebSocket (chat I/O)
3. Receives `init_state` + streaming events as JSON

pi-web-ui expects:
1. An `Agent` instance with `.prompt()`, `.subscribe()`, `.abort()`, etc.
2. Events emitted via the agent-core event system

---

## Integration Path Options

### Option A: Use pi-web-ui components inside React
- Web components work inside React (render `<agent-interface>` or `<chat-panel>` as custom elements)
- Create an adapter/proxy `Agent`-like object that:
  - Wraps the pi-socket WebSocket connection
  - Translates WebSocket events → agent-core event format
  - Translates `.prompt()` calls → WebSocket sends
- **Gain:** proper markdown rendering, code highlighting, thinking blocks, tool cards, streaming UI
- **Cost:** adapter complexity, mini-lit + Tailwind CSS alongside existing styles

### Option B: Replace React entirely with vanilla + pi-web-ui
- Build Pi-DE as a vanilla TS app using pi-web-ui components directly
- Keep React only for the roster sidebar / spawn modal (or also replace those)
- **Gain:** full alignment with pi-web-ui's design system
- **Cost:** major rewrite of existing working code

### Option C: Keep React, render pi-web-ui web components in the chat stage only (recommended)
- Only the center chat pane uses `<agent-interface>` or `<chat-panel>`
- Sidebar and modals remain React
- Smallest change footprint
- Need the WebSocket→Agent adapter regardless

---

## Implementation Steps

1. **Investigate pi-web-ui Agent interface contract** — what methods/events does `AgentInterface` expect from the `Agent` object
2. **Design WebSocket-to-Agent adapter** that wraps pi-socket connection as a pi-agent-core compatible Agent
3. **Install dependencies** — `@mariozechner/pi-web-ui`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`
4. **Replace the hand-rolled chat-area** div in App.tsx with `<agent-interface>` or `<chat-panel>` web component
5. **Wire the adapter** into the web component's `.session` property
6. **Import and configure pi-web-ui CSS** (`app.css` or Tailwind theme)
7. **Update event translation** — map pi-socket `init_state`/`delta`/`tool_start`/`tool_end` events to agent-core event types (`message_update`, `tool_execution_start`, etc.)
8. **Test rendering** — markdown, code highlighting, thinking blocks, and tool execution cards
9. **Update specs** if Agent adapter has limitations vs. full local Agent (e.g., no `.abort()`, no model switching)
