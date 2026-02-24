# Hyper-Pi: Requirements

## Terminology

All components, documentation, and user-facing messages MUST use these canonical names:

| Name | What It Is |
|------|-----------|
| **Hyper-Pi** | The project / overall system |
| **`pi`** | The CLI (Mario Zechner's unmodified pi-coding-agent) |
| **pi-socket** | The global `pi` extension providing WebSocket I/O |
| **hypivisor** | The central Rust registry daemon |
| **Pi-DE** | The web dashboard / IDE interface |

The default hypivisor port (31415) is a reference to π (3.1415…).

---

## 1. pi-socket Extension

### 1.1 WebSocket Server
- **R-PS-1:** On `pi` startup (`session_start` event), pi-socket MUST dynamically discover an available port (starting at 8080) and start a local WebSocket server.
- **R-PS-2:** The extension MUST print the WebSocket URL (e.g., `ws://localhost:8080`) via `ctx.ui.notify()` on startup, enabling standalone use without a hypivisor.
- **R-PS-3:** The extension MUST broadcast real-time agent events to all connected WebSocket clients by subscribing to pi's actual lifecycle events:
  - `message_update` with `text_delta` — streaming LLM text output
  - `message_update` with `thinking_delta` — streaming thinking/reasoning output
  - `message_update` with `toolcall_start` — LLM outputting a tool call (name + id from `partial.content[contentIndex]`)
  - `message_update` with `toolcall_delta` — incremental tool call arguments JSON
  - `tool_execution_start` — tool execution begins (name + arguments)
  - `tool_execution_end` — tool execution completes (including `isError` and text result)
  - `message_start` — message boundary; MUST include `content` for user messages so Pi-DE can display them
  - `message_end` — message boundary
- **R-PS-4:** The extension MUST accept incoming text messages from connected WebSocket clients and inject them into the active `pi` chat session via `pi.sendUserMessage()`. If the agent is currently streaming, the message MUST be delivered with `{ deliverAs: "followUp" }`. Users MUST be able to send messages at any time, including while the agent is busy.
- **R-PS-5:** On new client connection, the extension MUST send the complete conversation history by reading pi's native session state via `ctx.sessionManager.getBranch()` (not a duplicate cache).
- **R-PS-6:** On new client connection, the extension MUST send the list of tools/skills currently loaded in the `pi` instance via `pi.getAllTools()` (returns `{ name, description }[]`).
- **R-PS-7:** The initial connection payload MUST be a single `init_state` message containing both `events` (history) and `tools` arrays.
- **R-PS-8:** If the conversation history exceeds 500KB when serialized, the `init_state` payload MUST truncate older events and include a `truncated: true` flag and `totalEvents` count so the client can indicate incomplete history.
- **R-PS-9:** The extension MUST support multiple simultaneous WebSocket clients. All connected clients MUST receive the same broadcast events. Messages injected by any client MUST be visible to all other clients.

### 1.2 Hypivisor Registration
- **R-PS-10:** The extension MUST be installable globally (`~/.pi/agent/extensions/pi-socket.ts` or as a pi package via `pi install`) so it loads automatically for every `pi` instance.
- **R-PS-11:** On startup, the extension MUST attempt to connect to the hypivisor via WebSocket (default: `ws://localhost:31415/ws`).
- **R-PS-12:** The hypivisor URL MUST be configurable via the `HYPIVISOR_WS` environment variable.
- **R-PS-13:** If the hypivisor is reachable, the extension MUST send a JSON-RPC `register` message containing:
  - `id` — a unique, stable node identifier for the lifetime of the `pi` process (see R-PS-17)
  - `machine` — the OS hostname
  - `cwd` — the current working directory
  - `port` — the local WebSocket port
  - `status` — `"active"`
- **R-PS-14:** If the `HYPI_TOKEN` environment variable is set, the extension MUST pass it as a query parameter on the hypivisor WebSocket URL for authentication.
- **R-PS-15:** If the hypivisor is unreachable, the extension MUST log a message indicating standalone mode and continue operating normally. It MUST NOT crash or print error stack traces.

### 1.3 Resilience
- **R-PS-16:** If the hypivisor WebSocket connection drops, the extension MUST automatically attempt to reconnect every 5 seconds.
- **R-PS-17:** The node ID MUST be generated once at `pi` startup and reused across all reconnection attempts. This ensures the hypivisor updates the existing node entry rather than creating a duplicate on reconnect.
- **R-PS-18:** Network disconnections MUST NOT affect the running `pi` agent process in any way—no context loss, no state corruption, no process termination.
- **R-PS-18a:** If the hypivisor process crashes, is killed (including `SIGKILL`), or becomes unreachable for any reason, the pi agent MUST continue running completely unaffected. The local WebSocket server MUST remain operational for direct client connections. All pi.on() event handlers, tool execution, and LLM conversations MUST proceed as if the hypivisor never existed. The only impact is loss of dashboard visibility until the agent reconnects. **This is a non-negotiable invariant — the hypivisor can NEVER take down a pi agent.**
- **R-PS-18b:** All hypivisor WebSocket event handlers (`open`, `close`, `error`) MUST be wrapped in the `boundary()` safety net so that no exception from hypivisor-related code can propagate to the pi host process.
- **R-PS-19:** On `pi` exit (the `session_shutdown` event), the extension MUST close the local WebSocket server. The hypivisor connection will drop naturally.

### 1.4 Configuration
- **R-PS-20:** The starting port for dynamic discovery MUST default to 8080 but be overridable via the `PI_SOCKET_PORT` environment variable.
- **R-PS-21:** The reconnect interval MUST default to 5 seconds but be overridable via the `PI_SOCKET_RECONNECT_MS` environment variable.

### 1.5 Dependencies
- **R-PS-22:** The extension MUST use the `ws` library for WebSocket server functionality.
- **R-PS-23:** The extension MUST use the `portfinder` library for dynamic port discovery.
- **R-PS-24:** The extension MUST use Node's built-in `fetch` for any HTTP calls (no `node-fetch` or `axios`).

---

## 2. Hypivisor (Central Daemon)

### 2.1 Protocol
- **R-HV-1:** The hypivisor MUST expose a single WebSocket endpoint (`/ws`) as its only interface. There MUST be no HTTP REST endpoints.
- **R-HV-2:** All communication MUST use JSON-RPC over WebSockets. Each request includes an optional `id`, a `method` string, and optional `params`. Each response echoes the `id` with either a `result` or `error`.
- **R-HV-3:** The hypivisor MUST listen on port 31415 by default.
- **R-HV-4:** The default port MUST be overridable via a CLI argument (`--port` / `-p`).
- **R-HV-5:** The hypivisor MUST include a `protocol_version` field (starting at `"1"`) in the `init` event sent to newly connected clients. Pi-DE and pi-socket SHOULD warn if they encounter an unrecognized protocol version.
- **R-HV-6:** The hypivisor MUST process multiple in-flight JSON-RPC requests on the same WebSocket connection concurrently. A slow `list_directories` call MUST NOT block a simultaneous `list_nodes` response.

### 2.2 Authentication
- **R-HV-7:** The hypivisor MUST read the `HYPI_TOKEN` environment variable on startup.
- **R-HV-8:** If `HYPI_TOKEN` is set, the hypivisor MUST validate the `token` query parameter on every incoming WebSocket connection and reject connections with an invalid or missing token.
- **R-HV-9:** If `HYPI_TOKEN` is not set, the hypivisor MUST log a warning and operate without authentication.
- **R-HV-10:** The `HYPI_TOKEN` is a static pre-shared key with no expiry or rotation mechanism. This is acceptable for local and VPN/tunnel-protected deployments. For internet-exposed deployments, users are expected to provide network-level security (Tailscale, WireGuard, etc.).

### 2.3 Node Registry
- **R-HV-11:** The hypivisor MUST maintain an in-memory registry of all connected `pi` agent nodes, keyed by node ID.
- **R-HV-12:** The hypivisor MUST support the following JSON-RPC methods:

| Method | Params | Description |
|--------|--------|-------------|
| `register` | `{ id, machine, cwd, port, status }` | Register or re-register a pi agent node |
| `list_nodes` | *(none)* | Return the current array of all registered nodes |
| `list_directories` | `{ path? }` | List subdirectories at the given path (defaults to `$HOME`); skip hidden (dot) directories; sort alphabetically |
| `spawn_agent` | `{ path, new_folder? }` | Create the folder if `new_folder` is provided, then spawn a `pi` process in that directory |

### 2.4 Real-Time Events
- **R-HV-13:** On new WebSocket connection, the hypivisor MUST send an `init` event containing the full current node list and `protocol_version`.
- **R-HV-14:** When a node registers, the hypivisor MUST broadcast a `node_joined` event (with full node info) to all connected clients.
- **R-HV-15:** When a node's WebSocket disconnects, the hypivisor MUST mark that node as `"offline"` (not remove it) and broadcast a `node_offline` event.
- **R-HV-16:** When an offline node reconnects and re-registers (same `id`), the hypivisor MUST update its status back to `"active"` and broadcast a `node_joined` event.
- **R-HV-17:** Events MUST be pushed to clients via a broadcast channel, not polling.

### 2.5 Stale Node Cleanup
- **R-HV-18:** The hypivisor MUST remove nodes that have been in `"offline"` status for longer than a configurable TTL (default: 30 seconds).
- **R-HV-19:** When a stale node is removed, the hypivisor MUST broadcast a `node_removed` event with the node's `id`.
- **R-HV-20:** The TTL MUST be configurable via a CLI argument (`--node-ttl` / `-t`, in seconds).
- **R-HV-20a:** The cleanup sweep MUST also remove `"active"` nodes whose `last_seen` heartbeat timestamp exceeds 3× the TTL, to catch ghost registrations from crashed processes with half-open TCP connections.

### 2.6 Multiple Agents Per Directory
- **R-HV-20b:** Multiple pi agents MAY run simultaneously in the same project directory. Each agent has a unique session ID and a unique port. The hypivisor MUST NOT evict, deduplicate, or collapse nodes based on `cwd`. The only valid eviction key is `machine:port` — because a port on a machine can only belong to one process.
- **R-HV-20c:** Pi-DE MUST NOT deduplicate nodes by `cwd`. Two agents in the same directory MUST appear as two separate entries in the roster.

### 2.7 Process Spawning
- **R-HV-21:** The `spawn_agent` method MUST create any specified `new_folder` using recursive directory creation before spawning.
- **R-HV-22:** The `spawn_agent` method MUST spawn the `pi` CLI as a background child process in the target directory.
- **R-HV-23:** The spawned process's registration will happen automatically via the pi-socket extension—the hypivisor does not need to manually register it.
- **R-HV-24:** The `spawn_agent` method MUST reject paths that resolve outside the user's home directory. The resolved (canonicalized) path MUST start with `$HOME`.
- **R-HV-25:** The `spawn_agent` method MUST return an error if the target path does not exist and no `new_folder` is specified.

### 2.8 Directory Listing
- **R-HV-26:** The `list_directories` method MUST skip hidden entries (names starting with `.`).
- **R-HV-27:** The `list_directories` method MUST follow symlinks to directories (include them in the listing) but MUST NOT follow symlinks that point outside `$HOME`.
- **R-HV-28:** The `list_directories` method MUST silently skip entries that return permission errors. It MUST NOT fail the entire request due to a single unreadable entry.
- **R-HV-29:** The `list_directories` method MUST reject paths that resolve outside the user's home directory.

### 2.9 Technology
- **R-HV-30:** The hypivisor MUST be written in Rust.
- **R-HV-31:** The hypivisor MUST use the `clap` crate for CLI argument parsing.
- **R-HV-32:** The registry MUST be thread-safe (e.g., `Arc<RwLock<HashMap>>`).
- **R-HV-33:** The broadcast channel MUST use `asupersync::channel::broadcast`.

---

## 3. Pi-DE (Web Dashboard)

### 3.1 Layout
- **R-UI-1:** Pi-DE MUST use a responsive 3-pane layout:
  - **Left pane (280px):** Mesh Roster — lists all registered pi agents
  - **Center pane (fluid):** Chat Stage — the active agent's conversation interface
  - **Right pane (280px):** Inspector — loaded tools/skills for the active agent
- **R-UI-2:** The right (Inspector) pane MUST only appear when an agent is selected.
- **R-UI-3:** On viewports narrower than 768px (mobile), the layout MUST collapse to a single pane: the roster is shown by default, tapping a node opens the Chat Stage full-screen, and a back button returns to the roster. The Inspector pane MUST be accessible via a toggle/drawer.
- **R-UI-4:** All interactive elements MUST have touch-friendly sizing (minimum 44x44px tap targets) for mobile use.

### 3.2 Hypivisor Connection
- **R-UI-5:** On load, Pi-DE MUST connect to the hypivisor via WebSocket at `ws://localhost:{port}/ws?token={HYPI_TOKEN}`.
- **R-UI-6:** The hypivisor port and token MUST be configurable via environment variables (`VITE_HYPIVISOR_PORT`, `VITE_HYPI_TOKEN`).
- **R-UI-7:** Pi-DE MUST process hypivisor events in real time:
  - `init` → populate the full node roster
  - `node_joined` → add new node or update existing node to "active"
  - `node_offline` → mark node as offline in the roster
  - `node_removed` → remove node from the roster entirely
- **R-UI-8:** If the hypivisor WebSocket connection drops, Pi-DE MUST display a prominent "Disconnected from hypivisor" banner and attempt to reconnect every 5 seconds. When reconnected, Pi-DE MUST re-request the full node list via the `init` event.
- **R-UI-9:** If the initial hypivisor connection fails, Pi-DE MUST display a connection error screen with the target URL, a retry button, and troubleshooting hints (is hypivisor running? is the token correct?).

### 3.3 Roster (Left Pane)
- **R-UI-10:** Each node MUST display: project folder name (last path segment of CWD), hostname, port, and a status indicator dot.
- **R-UI-11:** Active nodes MUST show a glowing emerald status dot. Offline nodes MUST show a gray dot, dashed border, and reduced opacity (0.4).
- **R-UI-12:** Clicking an active node MUST select it, opening the Chat Stage and Inspector.
- **R-UI-13:** Offline nodes MUST be visually disabled (non-clickable) and display a tooltip: "Agent offline — waiting for reconnection."
- **R-UI-14:** The roster MUST include a "Spawn Agent" button that opens the spawn modal.

### 3.4 Spawn Modal
- **R-UI-15:** The spawn modal MUST present a file browser starting at the user's home directory.
- **R-UI-16:** The file browser MUST allow navigating into subdirectories (double-click) and up to parent directories.
- **R-UI-17:** The spawn modal MUST provide a text input for optionally creating a new subfolder.
- **R-UI-18:** Clicking "Deploy Agent Here" MUST send a `spawn_agent` JSON-RPC call to the hypivisor, then close the modal.
- **R-UI-19:** The newly spawned agent MUST appear in the roster automatically via the existing WebSocket event stream (no manual UI refresh).
- **R-UI-20:** If the `spawn_agent` RPC returns an error, the modal MUST remain open and display the error message.

### 3.5 Chat Stage (Center Pane)
- **R-UI-21:** When a node is selected, Pi-DE MUST open a WebSocket connection to the agent through the hypivisor proxy at `ws://hypivisor/ws/agent/{nodeId}`.
- **R-UI-22:** On connection, Pi-DE MUST receive and process the `init_state` payload to reconstruct the full conversation history.
- **R-UI-23:** If the `init_state` payload includes `truncated: true`, the UI MUST display a notice at the top of the chat: "Showing recent history ({n} of {totalEvents} events)."
- **R-UI-24:** Pi-DE MUST render the conversation using pi's official web UI components (`AgentInterface` from `@mariozechner/pi-web-ui`). A `RemoteAgent` class MUST duck-type pi-agent-core's `Agent` interface, receiving socket events and emitting `AgentEvent`s that `AgentInterface` subscribes to.
- **R-UI-25:** User messages typed in the Chat Stage MUST be sent to the agent via WebSocket and optimistically rendered in the UI. The message input MUST remain active while the agent is streaming, allowing follow-up messages at any time.
- **R-UI-26:** Real-time `delta` and `thinking_delta` events MUST be appended as streaming assistant content (text and thinking blocks respectively).
- **R-UI-27:** Real-time `toolcall_start` events MUST add `toolCall` content blocks to the streaming assistant message so pi-web-ui renders tool cards inline (with the appropriate renderer: `BashRenderer` for bash, `DefaultRenderer` for others). `toolcall_delta` events MUST update tool arguments incrementally.
- **R-UI-28:** Real-time `tool_start` / `tool_end` events MUST pair with the toolCall blocks. `tool_end` MUST create `toolResult` messages so pi-web-ui's `resultByCallId` map pairs results with calls. Completed tools MUST show results; in-progress tools MUST show a spinner.
- **R-UI-28a:** User messages typed in the pi TUI MUST appear in Pi-DE. pi-socket sends `message_start` with `role: "user"` and `content`, and `RemoteAgent` adds them to state.
- **R-UI-29:** Switching agents MUST cleanly close the previous WebSocket connection and clear the chat state before connecting to the new agent.
- **R-UI-30:** If the direct agent WebSocket connection fails or drops, the Chat Stage MUST display an inline "Connection lost — reconnecting…" message and retry every 5 seconds. If the agent's status in the roster is `"offline"`, the message MUST instead read "Agent offline — waiting for it to come back online."

### 3.6 Inspector (Right Pane)
- **R-UI-31:** On agent selection, Pi-DE MUST display the list of tools/skills from the `init_state` payload.
- **R-UI-32:** Each tool MUST display its name (in monospace font) and description.

### 3.7 Technology
- **R-UI-33:** Pi-DE MUST be built with React and Vite.
- **R-UI-34:** Pi-DE MUST use `@mariozechner/pi-web-ui` components where available (ChatPanel, ThemeProvider).
- **R-UI-35:** Pi-DE MUST use a dark theme consistent with terminal aesthetics.

---

## 4. Cross-Cutting Requirements

### 4.1 Authentication
- **R-CC-1:** All components MUST use the same `HYPI_TOKEN` value for Pre-Shared Key authentication.
- **R-CC-2:** Authentication MUST be entirely optional—the system MUST work without any token set.

### 4.2 Standalone Mode
- **R-CC-3:** pi-socket MUST be fully functional without a running hypivisor. Any client can connect directly to the agent's local WebSocket port.
- **R-CC-4:** The hypivisor is an optional enhancement, not a dependency. A pi agent that started with a working hypivisor MUST survive the hypivisor's death with zero impact to its operation. The relationship is strictly observe-only — the hypivisor observes agents, it does not control them.

### 4.3 Multi-Machine Support
- **R-CC-5:** The hypivisor MUST bind to `0.0.0.0` (all network interfaces) to support remote agent registrations.
- **R-CC-6:** The pi-socket extension MUST support pointing `HYPIVISOR_WS` to a remote host (not just localhost).
- **R-CC-7:** The Pi-DE MUST be able to connect to agent WebSockets on remote IPs (as reported in node registration data), assuming network reachability (e.g., via Tailscale or VPN).
- **R-CC-8:** The system does NOT provide its own tunneling or NAT traversal. Users are expected to ensure network reachability between components via their own infrastructure (Tailscale, WireGuard, SSH tunnels, etc.).

### 4.4 Graceful Degradation
- **R-CC-9:** If the hypivisor crashes or becomes unreachable while Pi-DE is open, Pi-DE MUST continue to function for any already-connected agent sessions. Only the roster and spawn capabilities are lost.
- **R-CC-10:** If pi-socket loses its hypivisor connection (including hypivisor crash or SIGKILL), the local WebSocket server for direct client connections MUST continue operating normally. Event broadcasting to local clients, message injection via `sendUserMessage`, and all pi agent functionality MUST be completely unaffected. The agent MUST automatically re-register when the hypivisor becomes available again.

### 4.5 Multi-Client Behavior
- **R-CC-11:** Multiple Pi-DE tabs/browsers MAY connect to the same hypivisor simultaneously. Each receives the same event stream.
- **R-CC-12:** Multiple Pi-DE clients MAY connect to the same pi-socket agent simultaneously. All receive the same broadcast events. Messages sent by any client are visible to all. No conflict resolution is provided—this is analogous to two people typing into the same terminal.

---

## 5. Explicit Non-Requirements

These items were discussed during design but are explicitly **not** in scope for the initial build. They are documented here for traceability.

### 5.1 Not Building (By Design Choice)
- **R-NR-1:** There is NO "kill agent" button in Pi-DE. Agents are stopped by the user at the terminal (Ctrl+C, `/quit`). The web UI is a viewport, not a process manager.
- **R-NR-2:** There is NO `HYPI_TOKEN` rotation, expiry, or multi-token support. The PSK is static. Network-level security (VPN/tunnel) is the expected hardening layer.
- **R-NR-3:** There is NO hypivisor persistence to disk. The registry is in-memory only. If the hypivisor restarts, agents re-register automatically via their reconnect loops.

### 5.2 Deferred to Future Phases
These features have clear value but are deferred to keep the initial build focused.

#### Orchestration & Multi-Agent
- **R-NR-4: Agent-to-agent communication.** Integration with [pi-messenger](https://github.com/nicobailon/pi-messenger) for inter-agent messaging and file reservation. Prerequisite: working single-agent Pi-DE.
- **R-NR-5: Ensemble orchestration.** Integration with [NTM (Neural Turing Machine)](https://github.com/dicklesworthstone/ntm) ensemble orchestration patterns for higher-level multi-agent task planning, delegation, and review workflows.
- **R-NR-6: Cross-machine agent coordination.** Syncing `pi-messenger` state directories across machines via Syncthing/Tailscale for distributed agent swarms. The hypivisor aggregates agents from all machines into a single registry.
- **R-NR-7: Agent discovery.** Agents query the hypivisor for other running agents by project, skill, or status. Enables dynamic delegation — an agent working on the backend can discover and message the frontend agent without human routing.
- **R-NR-8: Agent Cards.** Each agent publishing a JSON capability manifest (`{ skills, status, currentTask, project }`) for deterministic task routing by other agents and for Pi-DE to show richer roster information.

#### Shared Knowledge
- **R-NR-9: Shared semantic memory.** Integration with [CASS Memory System](https://github.com/Dicklesworthstone/cass_memory_system) for cross-agent knowledge sharing. Agents write what they've learned (API changes, architecture decisions, test results) and other agents query it — without direct communication.
- **R-NR-10: Structured handoff protocol.** A JSON schema for inter-agent task delegation (replacing natural language messages with typed payloads like `{ intent: "schema_update", diff: "..." }`).

#### Infrastructure & Deployment
- **R-NR-11: Hypivisor persistence.** Durable storage for the node registry so the hypivisor can restart without losing node metadata, session history, and agent statistics. See `specs/hypivisor-persistence.md`.
- **R-NR-12: Secure tunneling.** Built-in or recommended tunnel integration (Tailscale, Cloudflare Tunnel, ngrok) so the hypivisor and Pi-DE are accessible from anywhere without manual network configuration. The foundation must work solidly on localhost first.
- **R-NR-13: One-command deployment.** `npx hyper-pi` brings up the hypivisor, opens Pi-DE, and configures the extension — replacing the current four-step setup.

#### Pi-DE Enhancements
- **R-NR-14: Swarm status visualization.** Topology graph showing agent-to-agent message flow and file reservations in real time.
- **R-NR-15: A2UI (Agent-to-User Interface).** Agents emitting structured JSON payloads that Pi-DE renders as interactive widgets (diff viewers, approval buttons, schema comparisons) rather than raw markdown.
- **R-NR-16: Semantic zooming / progressive disclosure.** Collapsing successful tool runs into a single checkmark in the Chat Stage; expanding on click. Default view shows intent, not implementation.
- **R-NR-17: Task management.** Assign tasks to agents from Pi-DE, track progress, see completion status. Turns Pi-DE from a viewer into a control plane.
- **R-NR-18: Session browsing from Pi-DE.** Navigating pi's session tree and browsing previous sessions from the web UI (using `ctx.sessionManager` APIs).
- **R-NR-19: Notifications.** Push notifications (browser, mobile) when agents complete tasks, encounter errors, or need human input.

#### Reliability & Observability
- **R-NR-20: Self-hardening pattern (generalized).** Extract the two-layer error architecture (inner/outer) with structured logging, hardening skill, and hardening ledger into a reusable `pi-harden` extension usable by ANY project. See `plans/pi-harden-extension.md`.
- **R-NR-21: Richer agent status.** Extending node status beyond `active`/`offline` to include `idle`, `working`, `stuck` — derived from pi's lifecycle events (`agent_start`, `agent_end`, tool activity).
- **R-NR-22: Watchdog overseer.** A lightweight monitoring agent that watches active agents for infinite loops, repeated errors, or runaway token usage, and can interrupt or kill stuck agents.
- **R-NR-23: Ephemeral sandboxing.** Spawning agents in Docker containers for isolation, with MCP-based tool boundaries.
