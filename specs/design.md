# Hyper-Pi: Design

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Pi-DE (Web UI)                         │
│  ┌──────────┐  ┌────────────────────────┐  ┌────────────────┐  │
│  │  Roster   │  │     Chat Stage         │  │   Inspector    │  │
│  │  (nodes)  │  │  (active agent I/O)    │  │   (tools)      │  │
│  └─────┬─────┘  └───────────┬────────────┘  └───────┬────────┘  │
│        │                    │                        │           │
│        │ ws://hypivisor     │ ws://agent:port        │ from      │
│        │ :31415/ws          │ (direct connection)    │ init_state│
└────────┼────────────────────┼────────────────────────┼───────────┘
         │                    │                        │
         ▼                    ▼                        │
┌─────────────────┐   ┌──────────────────┐            │
│   hypivisor     │   │   pi instance    │◄───────────┘
│   (Rust daemon) │◄──│   + pi-socket    │
│   port 31415    │   │   extension      │
│                 │   │   port 8080+     │
│  • node registry│   │                  │
│  • broadcast    │   │  • WS server     │
│  • file browser │   │  • auto-register │
│  • agent spawn  │   │  • reconnect     │
└─────────────────┘   │  • history sync  │
         ▲            └──────────────────┘
         │
         │  (additional pi instances register independently)
         │
   ┌─────┴──────┐  ┌──────────────┐  ┌──────────────┐
   │ pi + socket │  │ pi + socket  │  │ pi + socket  │
   │ port 8081   │  │ port 8082    │  │ port 8083    │
   │ /backend    │  │ /mobile      │  │ /infra       │
   └─────────────┘  └──────────────┘  └──────────────┘
```

---

## WebSocket Message Catalogs

All WebSocket connections in Hyper-Pi use JSON text frames. This section defines the complete set of message types for each connection.

### pi-socket ↔ Client (Pi-DE or any WebSocket client)

**Server → Client (push events):**

| Type | Payload | When |
|------|---------|------|
| `init_state` | `{ type, events[], tools[], truncated?, totalEvents? }` | On client connect |
| `delta` | `{ type, text }` | LLM streaming text token |
| `thinking_delta` | `{ type, text }` | LLM streaming thinking token |
| `toolcall_start` | `{ type, name, id }` | LLM outputs a tool call in the assistant message |
| `toolcall_delta` | `{ type, id, argsDelta }` | Incremental tool call arguments JSON |
| `tool_start` | `{ type, name, args }` | Tool execution begins (after message_end) |
| `tool_end` | `{ type, name, isError, result? }` | Tool execution completes |
| `message_start` | `{ type, role, content? }` | Message boundary; includes `content` for user messages |
| `message_end` | `{ type, role }` | Message boundary |

**Event flow for a tool-using turn:**
```
message_start (assistant)
  → delta (text tokens)
  → toolcall_start (name, id)
  → toolcall_delta (incremental args JSON)
message_end (assistant) — message content includes toolCall blocks
tool_start (execution begins)
tool_end (execution completes with result)
message_start (assistant) — next turn with tool results
  → delta (text tokens)
message_end (assistant) — final response, no tool calls
```

**Client → Server (plain text):**

Clients send plain text strings (not JSON). Each string is injected as a user message via `pi.sendUserMessage()`. If the agent is currently streaming, the message is delivered with `{ deliverAs: "followUp" }` so it queues behind the current turn.

### pi-socket ↔ Hypivisor

**pi-socket → Hypivisor (JSON-RPC requests):**

| Method | Params |
|--------|--------|
| `register` | `{ id, machine, cwd, port, status }` |

**Hypivisor → pi-socket:** Only the JSON-RPC response to `register`. No push events are sent to agent connections.

### Hypivisor ↔ Pi-DE

**Pi-DE → Hypivisor (JSON-RPC requests):**

| Method | Params |
|--------|--------|
| `list_nodes` | *(none)* |
| `list_directories` | `{ path? }` |
| `spawn_agent` | `{ path, new_folder? }` |

**Hypivisor → Pi-DE (push events, no `id` field):**

| Event | Payload |
|-------|---------|
| `init` | `{ event, nodes[], protocol_version }` |
| `node_joined` | `{ event, node }` |
| `node_offline` | `{ event, id }` |
| `node_removed` | `{ event, id }` |

**Hypivisor → Pi-DE (JSON-RPC responses, with `id` field):** Standard `{ id, result?, error? }`.

### JSON-RPC Variant

Hyper-Pi uses a **simplified JSON-RPC** (not strict JSON-RPC 2.0):

- Requests: `{ id?: string, method: string, params?: any }`
- Responses: `{ id?: string, result?: any, error?: string }`
- Errors are plain strings, not the structured `{ code, message, data }` objects of JSON-RPC 2.0.
- Push events have an `event` field and no `id`, distinguishing them from RPC responses.

---

## Component Design

### 1. pi-socket Extension

**Location:** `~/.pi/agent/extensions/pi-socket/` (global install, directory style with `package.json`)

**Dependencies:** `ws`, `portfinder` (declared in `package.json`, installed via `npm install`)

**Key pi APIs used:**
- `pi.on(event, handler)` — subscribe to lifecycle events
- `pi.sendUserMessage(text, options?)` — inject user messages into the running session
- `pi.getAllTools()` — get loaded tools (`{ name, description }[]`)
- `ctx.sessionManager.getBranch()` — read the current conversation branch
- `ctx.ui.notify(msg, level)` — display startup messages
- `ctx.isIdle()` — check if agent is currently streaming

See [pi extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) for the full ExtensionAPI reference.

#### Reference Implementation

```typescript
// ~/.pi/agent/extensions/pi-socket/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import portfinder from "portfinder";
import os from "node:os";

const MAX_INIT_BYTES = 500 * 1024; // 500KB truncation threshold

export default function (pi: ExtensionAPI) {
  // State — scoped to this pi process's lifetime
  const nodeId = `${os.hostname()}-${Math.random().toString(36).substring(2, 8)}`;
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;
  let sessionCtx: any = null; // captured from session_start for use in event handlers

  const startPort = parseInt(process.env.PI_SOCKET_PORT || "8080", 10);
  const reconnectMs = parseInt(process.env.PI_SOCKET_RECONNECT_MS || "5000", 10);
  const hypivisorUrl = process.env.HYPIVISOR_WS || "ws://localhost:31415/ws";
  const hypiToken = process.env.HYPI_TOKEN || "";

  // ── Startup (non-blocking) ──────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionCtx = ctx;

    // 1. Find port and start local WS server
    const port = await portfinder.getPortPromise({ port: startPort });
    wss = new WebSocketServer({ port });
    ctx.ui.notify(`[pi-socket] ws://localhost:${port}`, "info");

    // 2. Handle incoming client connections
    wss.on("connection", (ws) => {
      // Send init_state immediately
      const initPayload = buildInitState(ctx);
      ws.send(JSON.stringify(initPayload));

      // Client → pi (plain text messages)
      ws.on("message", (data) => {
        const text = data.toString();
        if (ctx.isIdle()) {
          pi.sendUserMessage(text);
        } else {
          pi.sendUserMessage(text, { deliverAs: "followUp" });
        }
      });
    });

    // 3. Connect to hypivisor (fire-and-forget, non-blocking)
    connectToHypivisor(port, ctx);
  });

  // ── Event broadcasting ──────────────────────────────────────
  pi.on("message_update", async (event, _ctx) => {
    if (event.assistantMessageEvent?.type === "text_delta") {
      broadcast({ type: "delta", text: event.assistantMessageEvent.delta });
    }
  });

  pi.on("tool_execution_start", async (event, _ctx) => {
    broadcast({ type: "tool_start", name: event.toolName, args: event.args });
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    broadcast({ type: "tool_end", name: event.toolName, isError: event.isError });
  });

  pi.on("message_start", async (event, _ctx) => {
    broadcast({ type: "message_start", role: event.message.role });
  });

  pi.on("message_end", async (event, _ctx) => {
    broadcast({ type: "message_end", role: event.message.role });
  });

  // ── Shutdown ────────────────────────────────────────────────
  pi.on("session_shutdown", async (_event, _ctx) => {
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── History reconstruction ──────────────────────────────────
  function buildInitState(ctx: any) {
    const entries = ctx.sessionManager.getBranch();
    const tools = pi.getAllTools();
    const allEvents: any[] = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message;

      if (msg.role === "user") {
        // Extract text from content array
        const text = msg.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") || "";
        if (text) allEvents.push({ type: "user_message", text });

      } else if (msg.role === "assistant") {
        // Assistant messages may contain text and/or tool_use blocks
        for (const block of msg.content || []) {
          if (block.type === "text" && block.text) {
            allEvents.push({ type: "delta", text: block.text });
          } else if (block.type === "tool_use") {
            allEvents.push({ type: "tool_start", name: block.name, args: block.input });
          }
        }

      } else if (msg.role === "toolResult") {
        // Tool results indicate tool completion
        allEvents.push({
          type: "tool_end",
          name: msg.toolName,
          isError: msg.isError || false,
        });
      }
      // Skip: compaction entries, custom entries, branch summaries
    }

    // Truncation check
    const serialized = JSON.stringify(allEvents);
    if (serialized.length > MAX_INIT_BYTES) {
      const totalEvents = allEvents.length;
      // Drop oldest events until under budget
      while (JSON.stringify(allEvents).length > MAX_INIT_BYTES && allEvents.length > 10) {
        allEvents.shift();
      }
      return {
        type: "init_state",
        events: allEvents,
        tools,
        truncated: true,
        totalEvents,
      };
    }

    return { type: "init_state", events: allEvents, tools };
  }

  // ── Broadcast to all connected clients ──────────────────────
  function broadcast(payload: any) {
    if (!wss) return;
    const msg = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ── Hypivisor connection with reconnect loop ────────────────
  function connectToHypivisor(port: number, ctx: any) {
    const url = hypiToken
      ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
      : hypivisorUrl;

    try {
      hypivisorWs = new WebSocket(url);
    } catch {
      scheduleReconnect(port, ctx);
      return;
    }

    hypivisorWs.on("open", () => {
      ctx.ui.notify("[pi-socket] Connected to hypivisor", "info");
      hypivisorWs!.send(JSON.stringify({
        id: "reg",
        method: "register",
        params: {
          id: nodeId,
          machine: os.hostname(),
          cwd: process.cwd(),
          port,
          status: "active",
        },
      }));
    });

    hypivisorWs.on("close", () => {
      scheduleReconnect(port, ctx);
    });

    hypivisorWs.on("error", () => {
      // 'close' fires after 'error', which triggers reconnect
    });
  }

  function scheduleReconnect(port: number, ctx: any) {
    setTimeout(() => connectToHypivisor(port, ctx), reconnectMs);
  }
}
```

#### Startup Timing

The `session_start` handler is `async` but the hypivisor connection is **fire-and-forget** (`connectToHypivisor` returns immediately). The WebSocket server binds to a local port (fast). Neither operation blocks the pi TUI from becoming interactive.

#### TUI + Web Simultaneous Input

When a web client sends a message via pi-socket, it is injected via `pi.sendUserMessage()`. This behaves identically to the user typing at the terminal — it enters pi's message queue:

- If the agent is **idle**, the message triggers a new turn immediately. The terminal TUI user sees it appear as a user message.
- If the agent is **streaming**, the message is queued as a `followUp` and delivered after the current turn completes. The terminal user sees it queued.
- If the terminal user and a web user both send messages while the agent is streaming, both are queued and delivered in arrival order. This is the same behavior as pi's built-in message queue (steering + follow-up).

There is no conflict resolution. This matches the mental model of "multiple people typing into the same terminal."

---

### 2. Hypivisor

**Language:** Rust (asupersync)

**Default port:** 31415

**Interface:** Single WebSocket endpoint at `/ws`

**Crates:** `asupersync` (structured concurrency runtime with WebSocket, broadcast channels, cancel-correct Cx), `serde`/`serde_json`, `clap` (derive), `chrono`, `dirs`, `tracing`/`tracing-subscriber`

#### Module Architecture

The hypivisor is split into a library crate (`lib.rs`) and a thin binary entry point (`main.rs`). This enables in-process integration testing with coverage instrumentation.

```
src/main.rs        — CLI wrapper (44 lines): arg parsing → lib.rs
src/lib.rs         — Server core: TCP accept, WS upgrade, registry handler, proxy relay
src/handlers.rs    — Pure logic: routing, init events, proxy lookup, node lifecycle, base64
src/rpc.rs         — JSON-RPC dispatch (register, deregister, list_nodes, list_directories, spawn_agent, ping)
src/state.rs       — AppState, NodeInfo, NodeStatus, Registry types
src/auth.rs        — Token extraction and validation
src/fs_browser.rs  — Directory listing with symlink safety
src/spawn.rs       — Agent spawning with path validation
src/cleanup.rs     — Stale node removal (offline TTL + active ghost detection)

tests/server_integration.rs — 18 in-process integration tests (starts real server, connects via WebSocket)
```

The key design principle: **all pure logic lives in `handlers.rs`** (route matching, init event construction, proxy target lookup, node lifecycle state changes, base64 WebSocket key generation). The I/O glue in `lib.rs` calls into `handlers.rs` for decisions and only handles the TCP/WebSocket transport itself.

#### Concurrency

Each incoming TCP connection spawns a new OS thread (via `std::thread::spawn`). The registry handler uses a read-write lock (`RwLock`) for the node map and a broadcast channel (`asupersync::channel::broadcast`) for event fan-out to all connected dashboard clients. A separate forwarder thread per connection subscribes to the broadcast channel and writes events to the client's WebSocket. The proxy relay uses two threads per connection for bidirectional forwarding (dashboard↔agent).

#### Logging

The hypivisor uses `tracing` with `tracing-subscriber` (env-filter). Default level: `hypivisor=info`. Override via `RUST_LOG` environment variable. Logs to stderr.

#### Authentication Scope

The PSK (`HYPI_TOKEN`) provides identity verification, not encryption. It prevents unauthorized WebSocket connections but does not encrypt the wire. For deployments beyond localhost, users MUST provide transport-level security (TLS via reverse proxy, or encrypted tunnels via Tailscale/WireGuard).

---

### 3. Pi-DE (Web Dashboard)

**Technology:** React 18+ / Vite / TypeScript / `@mariozechner/pi-web-ui`

**Theme:** 7 built-in themes (dark, light, gruvbox-dark, tokyo-night, nord, solarized-dark, solarized-light) with full pi color token mapping to CSS custom properties. Users select from a dropdown in the sidebar; choice persists to localStorage. See "Theming" section below.

#### Layout

**Desktop (≥768px):** CSS Grid, 3 columns.

```css
.pi-de-layout {
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  height: 100vh;
}

/* Hide inspector when no agent selected */
.pi-de-layout.no-inspector {
  grid-template-columns: 280px 1fr;
}
```

**Mobile (<768px):** Single-pane stack with navigation.

```css
@media (max-width: 767px) {
  .pi-de-layout {
    display: flex;
    flex-direction: column;
  }
  .roster-pane { display: block; height: 100vh; }
  .main-stage  { display: none; }
  .inspector-pane { display: none; }

  /* When an agent is selected, swap visibility */
  .pi-de-layout.agent-selected .roster-pane { display: none; }
  .pi-de-layout.agent-selected .main-stage  { display: flex; flex-direction: column; height: 100vh; }

  /* Inspector as slide-out drawer, toggled via button */
  .inspector-drawer {
    position: fixed; right: 0; top: 0; bottom: 0;
    width: 280px; z-index: 100;
    transform: translateX(100%);
    transition: transform 0.2s;
  }
  .inspector-drawer.open { transform: translateX(0); }
}
```

All interactive elements use `min-height: 44px; min-width: 44px` for touch targets.

#### Connection Architecture

Pi-DE connects to agents **through the hypivisor proxy**, not directly to pi-socket ports. This simplifies CORS, firewall, and multi-machine routing.

```
Pi-DE → ws://hypivisor:31415/ws              (registry: node roster)
Pi-DE → ws://hypivisor:31415/ws/agent/{nodeId} (proxy: relayed to agent's pi-socket)
```

The proxy connection is transparent — pi-socket sees a normal WebSocket client, and Pi-DE receives all the same events as a direct connection.

**Key component: `RemoteAgent`** — duck-types pi-agent-core's `Agent` interface so pi-web-ui's `<agent-interface>` component works unchanged. Receives socket events, maintains `AgentState` (messages, isStreaming, tools, pendingToolCalls), and emits `AgentEvent`s that drive the UI.

Pi-DE maintains **two independent WebSocket connections** plus connection state:

```typescript
// ── Types ─────────────────────────────────────────────────────
interface NodeInfo {
  id: string;
  machine: string;
  cwd: string;
  port: number;
  status: "active" | "offline";
}

type HypivisorStatus = "connecting" | "connected" | "disconnected" | "error";
type AgentStatus = "connecting" | "connected" | "disconnected" | "offline";

interface Tool { name: string; description: string; }

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
```

#### State Management

```typescript
// Hypivisor connection
const [hvStatus, setHvStatus] = useState<HypivisorStatus>("connecting");
const [nodes, setNodes] = useState<NodeInfo[]>([]);
const [activeNode, setActiveNode] = useState<NodeInfo | null>(null);

// Agent connection
const [agentStatus, setAgentStatus] = useState<AgentStatus>("disconnected");
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [tools, setTools] = useState<Tool[]>([]);
const [historyTruncated, setHistoryTruncated] = useState(false);

// Mobile
const [showInspector, setShowInspector] = useState(false);
```

#### Hypivisor WebSocket Handler

```typescript
function connectToHypivisor(port: number, token: string) {
  const url = `ws://localhost:${port}/ws${token ? `?token=${token}` : ""}`;
  const ws = new WebSocket(url);

  ws.onopen = () => setHvStatus("connected");

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    // RPC response (has id)
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id)!;
      pendingRequests.delete(data.id);
      data.error ? reject(new Error(data.error)) : resolve(data.result);
      return;
    }

    // Push events
    switch (data.event) {
      case "init":
        setNodes(data.nodes);
        break;

      case "node_joined":
        setNodes(prev => {
          const filtered = prev.filter(n => n.id !== data.node.id);
          return [...filtered, { ...data.node, status: "active" }];
        });
        break;

      case "node_offline":
        setNodes(prev => prev.map(n =>
          n.id === data.id ? { ...n, status: "offline" } : n
        ));
        // If we're viewing this agent, update status
        setActiveNode(prev =>
          prev?.id === data.id ? { ...prev, status: "offline" } : prev
        );
        break;

      case "node_removed":
        setNodes(prev => prev.filter(n => n.id !== data.id));
        // If we were viewing the removed node, deselect
        setActiveNode(prev => prev?.id === data.id ? null : prev);
        break;
    }
  };

  ws.onclose = () => {
    setHvStatus("disconnected");
    setTimeout(() => connectToHypivisor(port, token), 5000);
  };

  ws.onerror = () => setHvStatus("error");

  return ws;
}
```

#### Agent WebSocket Handler

```typescript
function connectToAgent(node: NodeInfo) {
  setAgentStatus("connecting");
  setMessages([]);
  setTools([]);
  setHistoryTruncated(false);

  const ws = new WebSocket(`ws://${node.machine}:${node.port}`);

  ws.onopen = () => setAgentStatus("connected");

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "init_state") {
      setTools(payload.tools || []);
      setHistoryTruncated(payload.truncated || false);
      setMessages(rebuildHistory(payload.events));
      return;
    }

    setMessages(prev => {
      const chat = [...prev];
      const last = chat[chat.length - 1];

      switch (payload.type) {
        case "delta":
          if (!last || last.role !== "assistant") {
            chat.push({ role: "assistant", content: payload.text });
          } else {
            chat[chat.length - 1] = {
              ...last,
              content: last.content + payload.text,
            };
          }
          break;

        case "tool_start":
          chat.push({ role: "system", content: `⏳ Running \`${payload.name}\`…` });
          break;

        case "tool_end":
          // Update the most recent tool_start for this tool
          for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].role === "system" && chat[i].content.includes(payload.name)) {
              chat[i] = {
                ...chat[i],
                content: payload.isError
                  ? `✗ \`${payload.name}\` failed`
                  : `✓ \`${payload.name}\``,
              };
              break;
            }
          }
          break;

        case "user_message":
          // From another web client or injected source
          chat.push({ role: "user", content: payload.text });
          break;
      }
      return chat;
    });
  };

  ws.onclose = () => {
    setAgentStatus("disconnected");
    // Retry if node is still active
    setTimeout(() => {
      // Re-check node status from roster before reconnecting
      setNodes(currentNodes => {
        const node = currentNodes.find(n => n.id === activeNode?.id);
        if (node?.status === "active") {
          connectToAgent(node);
        } else {
          setAgentStatus("offline");
        }
        return currentNodes;
      });
    }, 5000);
  };

  return ws;
}

function rebuildHistory(events: any[]): ChatMessage[] {
  const chat: ChatMessage[] = [];
  for (const ev of events) {
    const last = chat[chat.length - 1];
    switch (ev.type) {
      case "user_message":
        chat.push({ role: "user", content: ev.text });
        break;
      case "tool_start":
        chat.push({ role: "system", content: `✓ \`${ev.name}\`` });
        break;
      case "tool_end":
        // Update matching tool_start
        for (let i = chat.length - 1; i >= 0; i--) {
          if (chat[i].role === "system" && chat[i].content.includes(ev.name)) {
            chat[i] = {
              ...chat[i],
              content: ev.isError ? `✗ \`${ev.name}\` failed` : `✓ \`${ev.name}\``,
            };
            break;
          }
        }
        break;
      case "delta":
        if (!last || last.role !== "assistant") {
          chat.push({ role: "assistant", content: ev.text });
        } else {
          chat[chat.length - 1] = { ...last, content: last.content + ev.text };
        }
        break;
    }
  }
  return chat;
}
```

#### JSON-RPC Client Helper (with timeout)

```typescript
const RPC_TIMEOUT_MS = 30_000;
const pendingRequests = new Map<string, {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function rpcCall(ws: WebSocket, method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substring(2, 9);

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, RPC_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Called from ws.onmessage when data.id is present:
function handleRpcResponse(data: { id: string; result?: any; error?: string }) {
  const pending = pendingRequests.get(data.id);
  if (!pending) return;
  pendingRequests.delete(data.id);
  clearTimeout(pending.timer);
  data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
}
```

#### Error State UI Components

```
┌──────────────────────────────────────────────────────────┐
│ Hypivisor disconnected                                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ⚠️  Cannot reach hypivisor at ws://…:31415/ws   │   │
│  │                                                   │   │
│  │  • Is the hypivisor running?                      │   │
│  │  • Is HYPI_TOKEN correct?                         │   │
│  │  • Check network connectivity                     │   │
│  │                                                   │   │
│  │  [ Retry ]                    Retrying in 3s…     │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────────────┐
│ Reconnection banner (top of page, dismissible)           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ⚠️  Disconnected from hypivisor — reconnecting… │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌────────────┐ ┌───────────────────┐ ┌──────────┐     │
│  │ frontend ● │ │   Chat Stage      │ │ Tools    │     │
│  │ backend  ● │ │   (still works!)  │ │ bash     │     │
│  │            │ │                   │ │ read     │     │
│  │ [Spawn] ←──── disabled           │ │          │     │
│  └────────────┘ └───────────────────┘ └──────────┘     │
└──────────────────────────────────────────────────────────┘
```

The Chat Stage for an already-connected agent continues to function when the hypivisor is disconnected. Only the Roster (no updates) and Spawn button (disabled) are affected.

Agent connection errors are shown inline in the Chat Stage:

| `agentStatus` | Chat Stage Content |
|---|---|
| `"connecting"` | Spinner: "Connecting to agent…" |
| `"connected"` | Normal chat UI |
| `"disconnected"` | "Connection lost — reconnecting…" (auto-retry) |
| `"offline"` | "Agent offline — waiting for it to come back online." (no retry until roster shows active) |

#### Spawn Modal (with error handling)

```typescript
function SpawnModal({ hvWs, onClose }) {
  const [currentPath, setCurrentPath] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load directories
  useEffect(() => {
    setError(null);
    rpcCall(hvWs, "list_directories", currentPath ? { path: currentPath } : {})
      .then(result => {
        setCurrentPath(result.current);
        setDirs(result.directories);
      })
      .catch(e => setError(e.message));
  }, [currentPath]);

  const handleSpawn = async () => {
    setError(null);
    setLoading(true);
    try {
      await rpcCall(hvWs, "spawn_agent", {
        path: currentPath,
        new_folder: newFolder || undefined,
      });
      onClose(); // Success — close modal. Agent appears via node_joined event.
    } catch (e: any) {
      setError(e.message); // Failure — keep modal open, show error.
    } finally {
      setLoading(false);
    }
  };

  // ... render: folder list, navigation, new folder input, error banner, Deploy button
}
```

The modal stays open on error, displaying the error message (e.g., "Path resolves outside home directory"). The Deploy button is disabled while `loading` is true.

#### History Truncation Notice

When `init_state` includes `truncated: true`:

```tsx
{historyTruncated && (
  <div className="truncation-notice">
    Showing recent history. Older messages were omitted due to conversation length.
  </div>
)}
```

---

## Multi-Machine Topology

For scaling across physical machines, the architecture extends naturally:

```
Machine A (laptop)              Machine B (cloud server)
┌──────────────────┐            ┌──────────────────┐
│ pi (frontend)    │            │ pi (data-proc)   │
│ pi-socket :8080  │──ws──┐    │ pi-socket :8080  │──ws──┐
│                  │      │    │                  │      │
│ pi (backend)     │      │    └──────────────────┘      │
│ pi-socket :8081  │──ws──┤                              │
└──────────────────┘      │    ┌──────────────────────┐  │
                          ├───►│     hypivisor        │◄─┘
                          │    │     :31415           │
                          │    │  (runs on Machine A  │
                          │    │   or a dedicated     │
                          │    │   server)            │
┌──────────────────┐      │    └──────────┬───────────┘
│ Pi-DE (browser)  │──ws──┘               │
│ on any device    │──ws──────────────────┘
└──────────────────┘
```

- Each pi-socket points `HYPIVISOR_WS` at the hypivisor's network address.
- The hypivisor stores each node's `machine` hostname and network-reachable `port`.
- Pi-DE connects to agents using the IP/hostname reported in node registration.
- Secure access across networks is provided by Tailscale, WireGuard, or similar tunneling.

---

## Agent Resilience Invariant

**The hypivisor can NEVER take down a pi agent.** This is the single most important architectural invariant in Hyper-Pi.

### The Rule

The hypivisor is an **observe-only** monitoring layer. It watches agents — it does not control them. If the hypivisor crashes, is killed (`SIGKILL`), loses power, or becomes unreachable for any reason:

1. **Every running pi agent continues operating normally** — no context loss, no state corruption, no process termination.
2. **The local WebSocket server (pi-socket) continues serving clients** — direct connections to `ws://agent:port` work exactly as before.
3. **Event broadcasting continues** — all connected Pi-DE clients and direct WebSocket clients receive events.
4. **Message injection continues** — clients can still send messages via WebSocket.
5. **The agent automatically re-registers** when the hypivisor becomes available again.

The **only** impact of a hypivisor crash is loss of dashboard roster visibility. Agents become invisible to Pi-DE, but they are not affected.

### Implementation

pi-socket enforces this invariant through two layers:

1. **Architectural isolation**: The hypivisor WebSocket client and the local WebSocket server are independent subsystems. They share no state that could corrupt if one fails. The hypivisor client is a fire-and-forget registration channel.

2. **Defense-in-depth error containment**: Every hypivisor-related WebSocket handler (`open`, `close`, `error`) is wrapped in `boundary()` — the outer safety net that catches unanticipated exceptions and logs them to the hardening log. No error from the hypivisor connection path can propagate to the pi host process.

### What This Means for Development

- **Never** add code where a hypivisor connection failure could affect local WSS operation.
- **Never** gate agent functionality (tool execution, message handling, event broadcasting) on `hypivisorConnected` state.
- **Always** wrap hypivisor-related callbacks in `boundary()`.
- **Always** test that the local WSS survives hypivisor `SIGKILL` (integration test: `hypivisor-resilience.test.ts`).

### Requirements

- R-PS-18: Network disconnections MUST NOT affect the running pi agent.
- R-PS-18a: Hypivisor crash MUST NOT crash the agent.
- R-PS-18b: All hypivisor handlers MUST be wrapped in `boundary()`.
- R-CC-4: The hypivisor is optional, not a dependency.
- R-CC-10: Local WSS continues after hypivisor loss.

---

## Error Handling Summary

### Pi-DE → Hypivisor

| Scenario | Behavior |
|----------|----------|
| Initial connection fails | Error screen with URL, troubleshooting hints, retry button. |
| Connection drops mid-session | Top banner: "Disconnected — reconnecting…" Retry every 5s. Agent sessions continue. |
| Reconnection succeeds | Banner disappears. Full node list re-fetched via `init` event. |

### Pi-DE → Agent (pi-socket)

| Scenario | Behavior |
|----------|----------|
| Connection fails | Inline in Chat Stage: "Cannot connect to agent on port {port}." |
| Connection drops | Inline: "Connection lost — reconnecting…" Retry every 5s. |
| Agent goes offline (per roster) | Inline: "Agent offline — waiting for it to come back online." |
| Reconnection succeeds | Message disappears. `init_state` re-received. Chat history repopulated. |

### pi-socket → Hypivisor

| Scenario | Behavior |
|----------|----------|
| Initial connection fails | `ctx.ui.notify()` standalone mode message. Retry loop runs in background. |
| Connection drops | Retry every 5s. Local WS server unaffected. No impact on pi or terminal TUI. |
| Reconnection succeeds | Re-register with same node ID. |

---

## Theming

Pi-DE supports 7 built-in themes that map pi's TUI color tokens to the web UI's CSS custom properties.

### Architecture

Pi's TUI themes define 51 color tokens as hex strings (accent, border, success, error, tool backgrounds, syntax highlighting, etc.). The web UI (`@mariozechner/mini-lit`) uses ~30 CSS custom properties in oklch color space. The bridge:

1. **`piThemes.ts`** — Embeds theme definitions with all 51 pi color tokens
2. **`hexToOklch()`** — Runtime hex→oklch conversion for mini-lit compatibility
3. **`applyPiTheme()`** — Sets CSS custom properties on `document.documentElement`
4. **`useTheme()`** — React hook exposing theme state, persisted to localStorage

### Available Themes

| Theme | Variant | Description |
|-------|---------|-------------|
| Dark | dark | Pi's default dark theme |
| Light | light | Pi's default light theme |
| Gruvbox Dark | dark | Retro warm palette |
| Tokyo Night | dark | Blue-purple palette |
| Nord | dark | Arctic blue-gray palette |
| Solarized Dark | dark | Teal on dark |
| Solarized Light | light | Teal on cream |

### CSS Custom Property Mapping

Pi tokens map to mini-lit properties:

| Pi Token | CSS Property |
|----------|-------------|
| `pageBg` | `--background` |
| `pageFg` | `--foreground` |
| `cardBg` | `--card` |
| `accent` | `--primary`, `--sidebar-primary` |
| `selectedBg` | `--secondary`, `--accent` |
| `borderMuted` | `--muted`, `--border`, `--input` |
| `muted` | `--muted-foreground` |
| `error` | `--destructive` |
| `border` | `--ring`, `--sidebar-ring` |

Pi-DE also sets `--pi-*` custom properties (e.g., `--pi-accent`, `--pi-success`, `--pi-error`) for sidebar chrome styling that doesn't map to mini-lit.

---

## Compact Tool Renderers

Pi-DE registers custom `ToolRenderer` implementations via pi-web-ui's `registerToolRenderer()` API to replace the generic `DefaultRenderer` ("Tool Call / Input JSON / Output text" cards) with compact, TUI-style rendering.

### Motivation

pi-web-ui ships a `DefaultRenderer` that renders all unregistered tools as verbose JSON cards. Pi's TUI renders each built-in tool with a compact, tool-aware format (e.g., `read ~/path:225-304` with syntax-highlighted code). The web UI's `registerToolRenderer()` API exists for consuming apps to register their own renderers.

### Registered Renderers

| Tool | Header Format | Content |
|------|--------------|---------|
| `read` | `read ~/path/to/file.ts:225-304` | Syntax-highlighted code block, collapsible |
| `write` | `write ~/path/to/file.ts` | File content preview, collapsible |
| `edit` | `edit ~/path/to/file.ts` | Old/new text diff, collapsible |
| `bash` | `$ command` | Console output, collapsible |
| `ls` | `ls src/` | File listing, collapsible |
| `find` | `find *.ts in src/` | Search results, collapsible |
| `grep` | `grep /pattern/ in src/` | Match results, collapsible |

All renderers use `renderCollapsibleHeader()` from pi-web-ui with tool-appropriate lucide icons. Content is truncated to a preview (10 lines for code, 20 for listings, 15 for grep) with "… (N more lines)" indicators.

Custom/extension tools (e.g., `pi_messenger`, `web_search`) fall through to the `DefaultRenderer`.

### Implementation

`toolRenderers.ts` defines all renderer classes and exports `registerCompactToolRenderers()`, called once at module scope in `App.tsx` before any `<agent-interface>` renders.

---

## Future Considerations

These capabilities were discussed in the design conversation but are not in scope for the initial build. See requirements.md §5 for the full deferred items list.

- Agent-to-agent communication via `pi-messenger`
- Cross-machine agent coordination via synced state directories
- Swarm status visualization (topology graph)
- A2UI — agents emitting structured JSON rendered as interactive widgets
- Semantic zooming / progressive disclosure
- Shared semantic memory (vector DB)
- Agent Cards (capability manifests)
- Structured handoff protocol
- Ephemeral sandboxing (Docker)
- Watchdog overseer
