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

**Crates:** `asupersync` (structured concurrency runtime with WebSocket, broadcast channels, cancel-correct Cx), `serde`/`serde_json`, `clap` (derive), `chrono`

#### Reference Implementation

```rust
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Query, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use chrono::Utc;
use clap::Parser;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env, fs,
    path::PathBuf,
    process::Command,
    sync::{Arc, RwLock},
};
use tokio::{net::TcpListener, sync::broadcast, time};

// ── CLI ───────────────────────────────────────────────────────
#[derive(Parser, Debug)]
#[command(name = "hypivisor", version, about = "Hyper-Pi central registry")]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 31415)]
    port: u16,

    /// Seconds before offline nodes are removed
    #[arg(short = 't', long, default_value_t = 3600)]
    node_ttl: u64,
}

// ── Data Model ────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
struct NodeInfo {
    id: String,
    machine: String,
    cwd: String,
    port: u16,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    offline_since: Option<i64>, // epoch seconds, set when status becomes "offline"
}

#[derive(Deserialize)]
struct RpcRequest {
    id: Option<String>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct RpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct AppState {
    nodes: RwLock<HashMap<String, NodeInfo>>,
    tx: broadcast::Sender<String>,
    secret_token: String,
    home_dir: PathBuf,
    node_ttl: u64,
}

type Registry = Arc<AppState>;

#[derive(Deserialize)]
struct WsAuth {
    token: Option<String>,
}

// ── Main ──────────────────────────────────────────────────────
#[tokio::main]
async fn main() {
    let args = Args::parse();
    let secret_token = env::var("HYPI_TOKEN").unwrap_or_default();

    if secret_token.is_empty() {
        eprintln!("⚠️  HYPI_TOKEN not set — running without authentication");
    }

    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    let (tx, _rx) = broadcast::channel(256);
    let state = Arc::new(AppState {
        nodes: RwLock::new(HashMap::new()),
        tx,
        secret_token,
        home_dir,
        node_ttl: args.node_ttl,
    });

    // Stale node cleanup task
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup_stale_nodes(&cleanup_state);
        }
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", args.port);
    let listener = TcpListener::bind(&addr).await.unwrap();
    eprintln!("🚀 Hypivisor online — ws://0.0.0.0:{}/ws", args.port);
    axum::serve(listener, app).await.unwrap();
}

// ── Stale cleanup ─────────────────────────────────────────────
fn cleanup_stale_nodes(state: &Registry) {
    let now = Utc::now().timestamp();
    let ttl = state.node_ttl as i64;
    let mut to_remove = vec![];

    {
        let nodes = state.nodes.read().unwrap();
        for (id, node) in nodes.iter() {
            if node.status == "offline" {
                if let Some(offline_since) = node.offline_since {
                    if now - offline_since > ttl {
                        to_remove.push(id.clone());
                    }
                }
            }
        }
    }

    if !to_remove.is_empty() {
        let mut nodes = state.nodes.write().unwrap();
        for id in &to_remove {
            nodes.remove(id);
            eprintln!("🗑️  Stale node removed: {}", id);
            let event = serde_json::json!({ "event": "node_removed", "id": id }).to_string();
            let _ = state.tx.send(event);
        }
    }
}

// ── WebSocket handler ─────────────────────────────────────────
async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(auth): Query<WsAuth>,
    State(state): State<Registry>,
) -> impl IntoResponse {
    // Auth check
    if !state.secret_token.is_empty() {
        if auth.token.as_deref() != Some(&state.secret_token) {
            return (axum::http::StatusCode::UNAUTHORIZED, "Invalid token").into_response();
        }
    }
    ws.on_upgrade(|socket| handle_socket(socket, state)).into_response()
}

async fn handle_socket(mut socket: WebSocket, state: Registry) {
    let mut rx = state.tx.subscribe();
    let mut registered_node_id: Option<String> = None;

    // Send init event with current node list
    {
        let nodes: Vec<NodeInfo> = state.nodes.read().unwrap().values().cloned().collect();
        let init = serde_json::json!({
            "event": "init",
            "nodes": nodes,
            "protocol_version": "1"
        });
        let _ = socket.send(Message::Text(init.to_string().into())).await;
    }

    loop {
        tokio::select! {
            // Incoming RPC from client
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(req) = serde_json::from_str::<RpcRequest>(&text) {
                            if req.method == "register" {
                                if let Some(ref params) = req.params {
                                    if let Ok(node) = serde_json::from_value::<NodeInfo>(params.clone()) {
                                        registered_node_id = Some(node.id.clone());
                                    }
                                }
                            }
                            let response = process_rpc(req, &state);
                            let out = serde_json::to_string(&response).unwrap();
                            if socket.send(Message::Text(out.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {} // ignore binary, ping, pong
                }
            }
            // Broadcast events to this client
            Ok(event) = rx.recv() => {
                if socket.send(Message::Text(event.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    // Disconnect: mark node offline (not removed)
    if let Some(node_id) = registered_node_id {
        let mut nodes = state.nodes.write().unwrap();
        if let Some(node) = nodes.get_mut(&node_id) {
            node.status = "offline".to_string();
            node.offline_since = Some(Utc::now().timestamp());
            eprintln!("⚠️  Node offline: {}", node_id);
        }
        drop(nodes);
        let event = serde_json::json!({ "event": "node_offline", "id": node_id }).to_string();
        let _ = state.tx.send(event);
    }
}

// ── RPC dispatch ──────────────────────────────────────────────
fn process_rpc(req: RpcRequest, state: &Registry) -> RpcResponse {
    let id = req.id.clone();
    match req.method.as_str() {
        "register" => rpc_register(id, req.params, state),
        "list_nodes" => rpc_list_nodes(id, state),
        "list_directories" => rpc_list_directories(id, req.params, state),
        "spawn_agent" => rpc_spawn_agent(id, req.params, state),
        _ => RpcResponse { id, result: None, error: Some("Method not found".into()) },
    }
}

fn rpc_register(id: Option<String>, params: Option<Value>, state: &Registry) -> RpcResponse {
    let Some(params) = params else {
        return RpcResponse { id, result: None, error: Some("Missing params".into()) };
    };
    let Ok(mut node) = serde_json::from_value::<NodeInfo>(params) else {
        return RpcResponse { id, result: None, error: Some("Invalid node info".into()) };
    };
    node.status = "active".to_string();
    node.offline_since = None;
    {
        let mut nodes = state.nodes.write().unwrap();
        nodes.insert(node.id.clone(), node.clone());
    }
    eprintln!("🔌 Node joined: {} (port {})", node.id, node.port);
    let event = serde_json::json!({ "event": "node_joined", "node": node }).to_string();
    let _ = state.tx.send(event);
    RpcResponse { id, result: Some(serde_json::json!({ "status": "registered" })), error: None }
}

fn rpc_list_nodes(id: Option<String>, state: &Registry) -> RpcResponse {
    let nodes: Vec<NodeInfo> = state.nodes.read().unwrap().values().cloned().collect();
    RpcResponse { id, result: Some(serde_json::to_value(nodes).unwrap()), error: None }
}

fn rpc_list_directories(id: Option<String>, params: Option<Value>, state: &Registry) -> RpcResponse {
    let target = params
        .and_then(|p| p.get("path").and_then(|v| v.as_str().map(String::from)))
        .map(PathBuf::from)
        .unwrap_or_else(|| state.home_dir.clone());

    // Canonicalize and enforce $HOME boundary
    let canonical = match fs::canonicalize(&target) {
        Ok(p) => p,
        Err(e) => return RpcResponse { id, result: None, error: Some(format!("Invalid path: {}", e)) },
    };
    if !canonical.starts_with(&state.home_dir) {
        return RpcResponse { id, result: None, error: Some("Path resolves outside home directory".into()) };
    }

    let mut directories = Vec::new();
    if let Ok(entries) = fs::read_dir(&canonical) {
        for entry in entries.flatten() {
            // Skip hidden entries
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') {
                continue;
            }
            // Check if it's a directory (follows symlinks)
            let Ok(metadata) = entry.metadata() else { continue }; // skip permission errors
            if !metadata.is_dir() {
                continue;
            }
            // If it's a symlink, verify the target is within $HOME
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                let Ok(resolved) = fs::canonicalize(entry.path()) else { continue };
                if !resolved.starts_with(&state.home_dir) {
                    continue;
                }
            }
            directories.push(name_str.to_string());
        }
    }
    directories.sort();

    RpcResponse {
        id,
        result: Some(serde_json::json!({
            "current": canonical.to_string_lossy(),
            "directories": directories,
        })),
        error: None,
    }
}

fn rpc_spawn_agent(id: Option<String>, params: Option<Value>, state: &Registry) -> RpcResponse {
    let Some(params) = params else {
        return RpcResponse { id, result: None, error: Some("Missing params".into()) };
    };
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let new_folder = params.get("new_folder").and_then(|v| v.as_str()).unwrap_or("").trim();

    let mut target = PathBuf::from(path_str);
    if !new_folder.is_empty() {
        target.push(new_folder);
    }

    // Create directory if needed
    if !target.exists() {
        if new_folder.is_empty() {
            return RpcResponse { id, result: None, error: Some("Path does not exist".into()) };
        }
        if let Err(e) = fs::create_dir_all(&target) {
            return RpcResponse { id, result: None, error: Some(format!("Failed to create directory: {}", e)) };
        }
    }

    // Canonicalize and enforce $HOME boundary
    let canonical = match fs::canonicalize(&target) {
        Ok(p) => p,
        Err(e) => return RpcResponse { id, result: None, error: Some(format!("Invalid path: {}", e)) },
    };
    if !canonical.starts_with(&state.home_dir) {
        return RpcResponse { id, result: None, error: Some("Path resolves outside home directory".into()) };
    }

    // Spawn pi as detached background process
    match Command::new("pi").current_dir(&canonical).spawn() {
        Ok(_) => {
            eprintln!("🚀 Spawning agent in: {}", canonical.display());
            RpcResponse { id, result: Some(serde_json::json!({ "status": "spawning", "path": canonical.to_string_lossy() })), error: None }
        }
        Err(e) => RpcResponse { id, result: None, error: Some(format!("Failed to spawn: {}", e)) },
    }
}
```

#### Concurrency

The `tokio::select!` loop in `handle_socket` processes incoming RPC requests and outbound broadcast events concurrently. Each WebSocket connection runs in its own Tokio task, so a slow `list_directories` on one connection does not block others. Within a single connection, requests are processed sequentially (one at a time) — this is acceptable because RPC calls are fast (filesystem reads, process spawns).

#### Logging

The hypivisor logs to stderr using `eprintln!`. All log lines are prefixed with an emoji for visual scanning:
- `🚀` startup / spawn
- `🔌` node joined
- `⚠️` node offline, auth warning
- `🗑️` stale node removed

For production deployments, stderr can be redirected to a file or log aggregator. Structured logging (JSON) is a future enhancement.

#### Authentication Scope

The PSK (`HYPI_TOKEN`) provides identity verification, not encryption. It prevents unauthorized WebSocket connections but does not encrypt the wire. For deployments beyond localhost, users MUST provide transport-level security (TLS via reverse proxy, or encrypted tunnels via Tailscale/WireGuard).

---

### 3. Pi-DE (Web Dashboard)

**Technology:** React 18+ / Vite / TypeScript / `@mariozechner/pi-web-ui`

**Theme:** Dark, terminal-aesthetic (near-black backgrounds, emerald accents, monospace metadata)

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
