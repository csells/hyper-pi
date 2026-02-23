/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and registers with the hypivisor.
 *
 * ## Error architecture
 *
 * pi.on() handlers: pi catches errors via ExtensionRunner.emit().
 * We let errors propagate so pi reports them.
 *
 * Node callbacks (wss.on, ws.on, setTimeout): wrapped with boundary()
 * which catches unanticipated errors and logs them with needsHardening.
 *
 * Inner layer: known errors handled at source (safeSerialize, readyState
 * guards, hypivisorUrlValid, defensive buildInitState).
 *
 * Outer layer: boundary() catches everything else → log → harden skill.
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
import type { AgentEvent, RpcRequest } from "./types.js";

export default function piSocket(pi: ExtensionAPI) {
  const nodeId = `${os.hostname()}-${process.pid}`;
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;
  let hypivisorUrlValid = true;
  let hypivisorConnected = false;
  let clientCount = 0;
  let reconnectDelay = 0;

  const startPort = parseInt(process.env.PI_SOCKET_PORT || "8080", 10);
  const reconnectMs = parseInt(process.env.PI_SOCKET_RECONNECT_MS || "5000", 10);
  const reconnectMaxMs = 5 * 60 * 1000; // cap at 5 minutes
  const hypivisorUrl = process.env.HYPIVISOR_WS || "ws://localhost:31415/ws";
  const hypiToken = process.env.HYPI_TOKEN || "";

  log.info("pi-socket", "extension loaded", { nodeId, hypivisorUrl, startPort });

  // ── Startup ─────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const port = await portfinder.getPortPromise({ port: startPort });
    wss = new WebSocketServer({ port });
    log.info("pi-socket", "WebSocket server listening", { port });

    wss.on("connection", boundary("wss.connection", (ws) => {
      clientCount++;
      log.info("pi-socket", "client connected", { clientCount });

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
        clientCount--;
        log.info("pi-socket", "client disconnected", { clientCount });
      });

      ws.on("error", () => {});
    }));

    wss.on("error", () => {});
    connectToHypivisor(port);
  });

  // ── Event broadcasting ──────────────────────────────────────
  // pi catches errors — no wrapping needed.

  pi.on("message_update", (event) => {
    if (event.assistantMessageEvent?.type === "text_delta") {
      broadcast({ type: "delta", text: event.assistantMessageEvent.delta });
    } else if (event.assistantMessageEvent?.type === "thinking_delta") {
      broadcast({ type: "thinking_delta", text: event.assistantMessageEvent.delta });
    }
  });

  pi.on("tool_execution_start", (event) => {
    broadcast({ type: "tool_start", name: event.toolName, args: event.args });
  });

  pi.on("tool_execution_end", (event) => {
    // Extract text content from tool result for display in Pi-DE
    let result: string | undefined;
    if (event.result?.content) {
      const texts = (event.result.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text);
      if (texts.length > 0) result = texts.join("\n");
    }
    broadcast({ type: "tool_end", name: event.toolName, isError: event.isError, result });
  });

  pi.on("message_start", (event) => {
    broadcast({ type: "message_start", role: event.message.role });
  });

  pi.on("message_end", (event) => {
    broadcast({ type: "message_end", role: event.message.role });
  });

  // ── Shutdown ────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    log.info("pi-socket", "shutting down", { nodeId });
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── Broadcast ───────────────────────────────────────────────
  function broadcast(payload: AgentEvent): void {
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
        // Lost an established connection — worth logging.
        log.warn("hypivisor", "disconnected, will reconnect");
      }
      // First attempt or still retrying — silent. The initial
      // "extension loaded" entry already shows the target URL.
      scheduleReconnect(port);
    });

    ws.on("error", () => {
      // close event follows — reconnect handled there.
    });
  }

  function scheduleReconnect(port: number): void {
    // Exponential backoff: 5s → 10s → 20s → ... → 5m cap
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
