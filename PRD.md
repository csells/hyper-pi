# Pi-DE Quality of Life Features PRD

## Overview
Improve the Pi-DE web dashboard user experience with quality-of-life enhancements
from TODO.md. These are UI/UX improvements to the existing React + pi-web-ui dashboard.

## Codebase Context
- **Pi-DE**: React + Vite + TypeScript app in `pi-de/`
- **Core files**: `src/App.tsx` (root component), `src/App.css` (styles),
  `src/RemoteAgent.ts` (WebSocket agent adapter), `src/useAgent.ts` (agent hook),
  `src/useHypivisor.ts` (hypivisor hook), `src/types.ts` (shared types re-exports)
- **Protocol**: `hyper-pi-protocol/src/index.ts` shared types between pi-socket and pi-de
- **pi-socket**: `pi-socket/src/index.ts` - WebSocket extension for pi agents
- **Rendering**: Uses `@mariozechner/pi-web-ui` `<agent-interface>` web component.
  pi-web-ui uses Tailwind CSS with a `.dark` class on a container ancestor to switch
  between light and dark mode. The CSS defines `:root` variables (light) and `.dark`
  overrides. Pi-DE currently hardcodes `dark` on the `agent-interface-container`.
- **Pi agent themes**: pi has built-in `dark` and `light` themes (JSON files with 51
  color tokens). These are TUI themes for the terminal. For Pi-DE (web), the relevant
  theming is the pi-web-ui Tailwind dark/light mode. Custom user themes from
  `~/.pi/agent/themes/*.json` are terminal-only and don't apply to the web UI.
- **Build**: `cd pi-de && npm run build` to verify, `npm test` for tests, `npm run lint` for types
- **Existing tests**: `src/App.test.tsx`, `src/useAgent.test.ts`, `src/useHypivisor.test.ts`,
  `src/RemoteAgent.test.ts`, `src/SpawnModal.test.tsx`

## Features (Priority Order)

### F1: Group Agents by Project in Roster
Currently agents are listed flat. Group them by project directory (last path
segment of `cwd`). Each project group is collapsible with a header showing the
project name. Agents in the same project appear together. This replaces the flat
`node-list` rendering in App.tsx.

**Files to modify**: `src/App.tsx` (roster rendering), `src/App.css` (group styles)

### F2: Agent Working/Idle Status Indicator
Show whether the currently selected agent is working (streaming/tool execution)
or idle. Use a pulsing yellow dot for working, static green dot for idle. The
`RemoteAgent` already tracks `isStreaming` in its state. For the selected agent,
reflect this in both the roster card and the stage header.

For non-selected agents, we don't have streaming state (no WebSocket open), so
keep the current static green/gray dots. Only the selected agent gets the
enhanced indicator.

**Files to modify**: `src/App.tsx`, `src/App.css`

### F3: Show Session Name + Project Name in Header
Currently the stage header shows the full `activeNode.cwd`. Instead show:
- Project name (last path segment) prominently
- Machine:port as metadata
- An editable session name (stored in localStorage keyed by nodeId) that defaults
  to the project name but can be customized by clicking on it

**Files to modify**: `src/App.tsx`, `src/App.css`

### F4: Handle Offline Agents Better
Greyed-out (offline) agents are clickable but show an empty chat. Instead:
- Show a clear "Agent Offline" message in the chat stage when an offline agent is
  selected, with the agent's last known info
- Don't show the message input for offline agents
- After the TTL (30s), the hypivisor removes them and they disappear automatically

**Files to modify**: `src/App.tsx`, `src/App.css`

### F5: Fix Scroll Position on Agent Selection
When selecting an agent, the chat should scroll to the bottom (most recent
messages), not to a random position from a previous agent's scroll state.
The `<agent-interface>` web component likely has its own scroll container — we
need to scroll that to the bottom after the init_state is received and rendered.

**Files to modify**: `src/App.tsx`

### F6: Theming — Dark, Light, System with Persistence
Support the pi agent's built-in themes in Pi-DE:
- **Dark mode** (current default): `.dark` class on `agent-interface-container`,
  dark Pi-DE CSS variables
- **Light mode**: remove `.dark` class, add light Pi-DE CSS variables
- **System**: follow `prefers-color-scheme` media query
- Persist the choice in `localStorage` (key: `pi-de-theme`)
- Add a theme toggle button (🌙/☀️/🖥️) in the sidebar header area
- Pi-DE's own CSS variables (--bg-dark, --bg-panel, etc.) need light-mode variants
- The `<agent-interface>` component uses Tailwind's `.dark` class — toggling this
  handles the web component theme automatically

**Files to modify**: `src/App.tsx`, `src/App.css`

### F7: Show System PID for Debugging
Display the system PID in the agent's metadata. The PID is `process.pid` in
pi-socket. Add `pid` to the registration so it flows through the protocol.

**Files to modify**:
- `hyper-pi-protocol/src/index.ts` (add optional `pid?: number` to `NodeInfo`)
- `pi-socket/src/index.ts` (send `pid: process.pid` in register params)
- `hypivisor/src/` (pass through `pid` field in node registration — check the Rust structs)
- `pi-de/src/App.tsx` (display pid in node card metadata)

## Testing Requirements
- All new UI features must have unit tests in the appropriate test files
- Run `cd pi-de && npm test` to verify tests pass
- Run `cd pi-de && npm run build` to verify the build succeeds
- Run `cd pi-de && npm run lint` to verify type checking passes
- Run `cd hyper-pi-protocol && npm run build` if protocol types change
- Run `cd pi-socket && npm run build && npm test` if pi-socket changes
- If hypivisor Rust code changes: `cd hypivisor && cargo test && cargo build`

## Architecture Constraints
- **pi is never modified** — changes only to pi-socket, hypivisor, pi-de, and hyper-pi-protocol
- Follow existing patterns in the codebase
- Keep changes minimal and focused
- TDD: write tests first, then implement
