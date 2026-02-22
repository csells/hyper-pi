/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and registers with the hypivisor.
 *
 * ## Error handling strategy
 *
 * There are two execution contexts with different error behavior:
 *
 * 1. **pi.on() handlers** — pi's ExtensionRunner wraps every handler call
 *    in try/catch + await. Thrown exceptions and rejected promises are
 *    caught by pi and routed to emitError(). These CANNOT crash the
 *    host process. We let errors propagate here so pi can report them
 *    and we can find logic bugs.
 *
 * 2. **Node event-loop callbacks** — wss.on("connection"), ws.on("message"),
 *    ws.on("open"), setTimeout callbacks. These run outside pi's event
 *    system. An uncaught throw here becomes process.uncaughtException
 *    and WILL terminate pi. Each call site that could throw is guarded
 *    for the specific known failure mode, not with blanket try/catch.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import portfinder from "portfinder";
import os from "node:os";
import { buildInitState } from "./history.js";
import type { AgentEvent, RpcRequest } from "./types.js";

export default function piSocket(pi: ExtensionAPI) {
  const nodeId = `${os.hostname()}-${process.pid}`;
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;
  let hypivisorUrlValid = true; // tracks if HYPIVISOR_WS is a valid URL

  const startPort = parseInt(process.env.PI_SOCKET_PORT || "8080", 10);
  const reconnectMs = parseInt(process.env.PI_SOCKET_RECONNECT_MS || "5000", 10);
  const hypivisorUrl = process.env.HYPIVISOR_WS || "ws://localhost:31415/ws";
  const hypiToken = process.env.HYPI_TOKEN || "";

  // ── Startup ─────────────────────────────────────────────────
  // pi catches errors from this handler via ExtensionRunner.emit().
  // If portfinder or WebSocketServer fails, pi logs the error and
  // the extension is inert — but pi continues running.
  pi.on("session_start", async (_event, ctx) => {
    const port = await portfinder.getPortPromise({ port: startPort });
    wss = new WebSocketServer({ port });

    // --- Node event-loop boundary: connection handler ---
    wss.on("connection", (ws) => {
      // buildInitState never throws (validates all inputs, returns empty on failure).
      // safeSerialize never throws (strips non-serializable values).
      // ws.send only throws if readyState != OPEN — guarded.
      const initPayload = buildInitState(
        ctx.sessionManager.getBranch(),
        pi.getAllTools(),
      );
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(safeSerialize(initPayload));
      }

      // --- Node event-loop boundary: message handler ---
      // pi.sendUserMessage is pi's own API running in pi's process.
      // If it throws synchronously (undocumented), we can't let that
      // propagate to uncaughtException. This is a defensive boundary
      // against a third-party API we don't control.
      ws.on("message", (data) => {
        try {
          const text = data.toString();
          if (ctx.isIdle()) {
            pi.sendUserMessage(text);
          } else {
            pi.sendUserMessage(text, { deliverAs: "followUp" });
          }
        } catch {
          // pi.sendUserMessage threw — nothing we can do from here.
          // If this ever fires, it means pi's API has an undocumented
          // throw path that should be reported upstream.
        }
      });

      ws.on("error", () => {});
    });

    wss.on("error", () => {});

    connectToHypivisor(port);
  });

  // ── Event broadcasting ──────────────────────────────────────
  // These run inside pi's event system (ExtensionRunner.emit catches errors).
  // No try/catch needed — if broadcast() has a bug, pi reports it via
  // emitError() and we'll see it in pi's error diagnostics.

  pi.on("message_update", (event) => {
    if (event.assistantMessageEvent?.type === "text_delta") {
      broadcast({ type: "delta", text: event.assistantMessageEvent.delta });
    }
  });

  pi.on("tool_execution_start", (event) => {
    broadcast({ type: "tool_start", name: event.toolName, args: event.args });
  });

  pi.on("tool_execution_end", (event) => {
    broadcast({ type: "tool_end", name: event.toolName, isError: event.isError });
  });

  pi.on("message_start", (event) => {
    broadcast({ type: "message_start", role: event.message.role });
  });

  pi.on("message_end", (event) => {
    broadcast({ type: "message_end", role: event.message.role });
  });

  // ── Shutdown ────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── Broadcast to all connected clients ──────────────────────
  // Called from pi.on() handlers only (errors caught by pi).
  // ws.send only throws if readyState != OPEN — guarded.
  // JSON.stringify on AgentEvent payloads: the only field that could
  // be non-serializable is `args` in tool_start (from pi's event data).
  // We use safeSerialize to handle that.
  function broadcast(payload: AgentEvent): void {
    if (!wss) return;
    const msg = safeSerialize(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ── Hypivisor connection with reconnect loop ────────────────
  function connectToHypivisor(port: number): void {
    // If we've already determined the URL is invalid, don't retry.
    // The user needs to fix HYPIVISOR_WS and restart pi.
    if (!hypivisorUrlValid) return;

    const url = hypiToken
      ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
      : hypivisorUrl;

    // new WebSocket(url) throws synchronously on invalid URL.
    // This is a config error, not a transient failure — stop retrying.
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      hypivisorUrlValid = false;
      // Don't retry — the URL is malformed and retrying won't help.
      return;
    }
    hypivisorWs = ws;

    // --- Node event-loop boundary: open handler ---
    ws.on("open", () => {
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
    });

    ws.on("close", () => {
      scheduleReconnect(port);
    });

    ws.on("error", () => {});
  }

  function scheduleReconnect(port: number): void {
    setTimeout(() => connectToHypivisor(port), reconnectMs);
  }
}

// ── Safe serializer ──────────────────────────────────────────
// JSON.stringify throws on circular refs and BigInt. Tool args come
// from pi's event system and are opaque `unknown` — we can't guarantee
// they're serializable. This function never throws.
function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // Circular ref or BigInt — strip the problematic `args` field
    // and serialize without it. This loses tool args but keeps the
    // stream alive. Better than crashing.
    try {
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === "bigint") return val.toString();
        if (typeof val === "function") return undefined;
        return val;
      });
    } catch {
      // Still failing (deep circular ref). Return minimal valid JSON.
      return '{"type":"error","message":"non-serializable event"}';
    }
  }
}
