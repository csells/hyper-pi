/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and registers with the hypivisor.
 *
 * ## Event forwarding
 *
 * pi-socket forwards pi's native extension events directly over WebSocket.
 * No decomposition, no custom event format. Pi-DE receives the same
 * AgentEvent objects that pi-web-ui's AgentInterface expects, so
 * RemoteAgent is just a thin pass-through.
 *
 * ## Error architecture
 *
 * pi.on() handlers: pi catches errors via ExtensionRunner.emit().
 * We let errors propagate so pi reports them.
 *
 * Node callbacks (wss.on, ws.on, setTimeout): wrapped with boundary()
 * which catches unanticipated errors and logs them with needsHardening.
 *
 * ## Logging
 *
 * All operational events are logged to ~/.pi/logs/pi-socket.jsonl as
 * structured JSONL. Errors needing attention are marked needsHardening.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import portfinder from "portfinder";
import os from "node:os";
import { buildInitState } from "./history.js";
import { boundary } from "./safety.js";
import * as log from "./log.js";
import type { RpcRequest } from "./types.js";

export default function piSocket(pi: ExtensionAPI) {
  let nodeId = process.pid.toString(); // fallback until session provides UUID
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;
  let hypivisorUrlValid = true;
  let hypivisorConnected = false;
  let reconnectDelay = 0;

  const startPort = parseInt(process.env.PI_SOCKET_PORT || "8080", 10);
  const reconnectMs = parseInt(process.env.PI_SOCKET_RECONNECT_MS || "5000", 10);
  const reconnectMaxMs = 5 * 60 * 1000; // cap at 5 minutes
  const hypivisorUrl = process.env.HYPIVISOR_WS || "ws://localhost:31415/ws";
  const hypiToken = process.env.HYPI_TOKEN || "";

  log.info("pi-socket", "extension loaded", { nodeId, hypivisorUrl, startPort });

  // ── Startup ─────────────────────────────────────────────────
  let wssPort: number | null = null; // remember our port across session restarts

  pi.on("session_start", async (_event, ctx) => {
    // Use the stable session ID so hypivisor can deduplicate across restarts
    nodeId = ctx.sessionManager.getSessionId();

    // Close previous WSS if session restarts — prevents stale port registrations
    if (wss) {
      wss.close();
      wss = null;
    }

    // Reuse our previous port if still available, otherwise find a new one
    const port = wssPort ?? (await portfinder.getPortPromise({ port: startPort }));
    wss = new WebSocketServer({ port });
    wssPort = port;
    log.info("pi-socket", "WebSocket server listening", { port, nodeId });

    wss.on("connection", boundary("wss.connection", (ws) => {
      log.info("pi-socket", "client connected");

      const initPayload = buildInitState(
        ctx.sessionManager.getBranch(),
        pi.getAllTools(),
      );
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(safeSerialize(initPayload));
      }

      ws.on("message", boundary("ws.message", (data) => {
        const text = data.toString();
        if (ctx.isIdle()) {
          pi.sendUserMessage(text);
        } else {
          pi.sendUserMessage(text, { deliverAs: "followUp" });
        }
      }));

      ws.on("close", () => {
        log.info("pi-socket", "client disconnected");
      });

      ws.on("error", () => {});
    }));

    wss.on("error", () => {});
    connectToHypivisor(port);
  });

  // ── Event forwarding ────────────────────────────────────────
  // Forward pi's native events directly over WebSocket.
  // pi catches errors from extension handlers — no wrapping needed.

  pi.on("message_start", (event) => broadcast(event));
  pi.on("message_update", (event) => broadcast(event));
  pi.on("message_end", (event) => broadcast(event));

  pi.on("tool_execution_start", (event) => broadcast(event));
  pi.on("tool_execution_update", (event) => broadcast(event));
  pi.on("tool_execution_end", (event) => broadcast(event));

  // ── Shutdown ────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    log.info("pi-socket", "shutting down", { nodeId });
    // Deregister from hypivisor before closing connections
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const rpc: RpcRequest = {
        id: "dereg",
        method: "deregister",
        params: { id: nodeId },
      };
      hypivisorWs.send(JSON.stringify(rpc));
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── Broadcast ───────────────────────────────────────────────
  function broadcast(payload: unknown): void {
    if (!wss) return;
    const msg = safeSerialize(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ── Hypivisor connection ────────────────────────────────────
  function connectToHypivisor(port: number): void {
    if (!hypivisorUrlValid) return;

    const url = hypiToken
      ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
      : hypivisorUrl;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      log.warn("hypivisor", "invalid URL, giving up", { url: hypivisorUrl });
      hypivisorUrlValid = false;
      return;
    }
    hypivisorWs = ws;

    ws.on("open", boundary("hypivisor.open", () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const rpc: RpcRequest = {
        id: "reg",
        method: "register",
        params: {
          id: nodeId,
          machine: os.hostname(),
          cwd: process.cwd(),
          port,
          status: "active",
        },
      };
      ws.send(JSON.stringify(rpc));
      hypivisorConnected = true;
      reconnectDelay = 0;
      log.info("hypivisor", "registered", { nodeId, port });
    }));

    ws.on("close", () => {
      const wasConnected = hypivisorConnected;
      hypivisorConnected = false;
      if (wasConnected) {
        log.warn("hypivisor", "disconnected, will reconnect");
      }
      scheduleReconnect(port);
    });

    ws.on("error", () => {});
  }

  function scheduleReconnect(port: number): void {
    reconnectDelay = reconnectDelay === 0
      ? reconnectMs
      : Math.min(reconnectDelay * 2, reconnectMaxMs);
    setTimeout(boundary("reconnect", () => {
      connectToHypivisor(port);
    }), reconnectDelay);
  }
}

// ── Safe serializer ──────────────────────────────────────────
function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === "bigint") return val.toString();
        if (typeof val === "function") return undefined;
        return val;
      });
    } catch {
      return '{"type":"error","message":"non-serializable event"}';
    }
  }
}
