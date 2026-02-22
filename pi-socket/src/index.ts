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
 *    and WILL terminate pi. These need targeted try/catch at the boundary
 *    for specific expected errors only (network I/O), and we log unexpected
 *    errors to a file so logic bugs are visible.
 *
 * We do NOT blanket try/catch everything. Expected errors (network disconnect,
 * port unavailable) are handled at the specific call site. Logic bugs are
 * allowed to propagate to pi's error system (in pi.on handlers) or logged
 * with full stack trace (in Node callbacks) so they get fixed.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import portfinder from "portfinder";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { buildInitState } from "./history.js";
import type { AgentEvent, RpcRequest } from "./types.js";

// ── Error logging to file (not TUI) ──────────────────────────
// Errors are appended to ~/.pi/logs/pi-socket.log so they're visible
// for debugging without flooding the pi TUI.
const LOG_DIR = path.join(os.homedir(), ".pi", "logs");
const LOG_FILE = path.join(LOG_DIR, "pi-socket.log");

function logError(context: string, err: unknown): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    fs.appendFileSync(LOG_FILE, `[${ts}] ${context}: ${msg}\n`);
  } catch {
    // If we can't write the log file, there's nothing else to do.
    // We absolutely cannot throw here.
  }
}

export default function piSocket(pi: ExtensionAPI) {
  const nodeId = `${os.hostname()}-${process.pid}`;
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;

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
    // Runs outside pi's event system. Must not throw.
    wss.on("connection", (ws) => {
      // buildInitState is designed to never throw (returns empty state on failure).
      // JSON.stringify could throw if tool args contain circular refs (from pi's
      // session data). This is a Node boundary so we guard it specifically.
      // ws.send throws if readyState != OPEN, guarded below.
      const initPayload = buildInitState(
        ctx.sessionManager.getBranch(),
        pi.getAllTools(),
      );
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(initPayload));
        } catch (err) {
          // JSON.stringify failed (circular tool args?) or send failed.
          // Log it — this likely indicates a bug in session data shape.
          logError("wss.on(connection) → send initPayload", err);
        }
      }

      // --- Node event-loop boundary: message handler ---
      ws.on("message", (data) => {
        // pi.sendUserMessage is pi's own API. If it throws, that's a pi bug,
        // not ours — but we still can't let it crash the process from here.
        try {
          const text = data.toString();
          if (ctx.isIdle()) {
            pi.sendUserMessage(text);
          } else {
            pi.sendUserMessage(text, { deliverAs: "followUp" });
          }
        } catch (err) {
          logError("ws.on(message) → pi.sendUserMessage", err);
        }
      });

      ws.on("error", () => {
        // Expected: client disconnects, network error. No action needed.
      });
    });

    wss.on("error", () => {
      // Expected: port conflict after bind (rare). No action needed.
    });

    connectToHypivisor(port);
  });

  // ── Event broadcasting ──────────────────────────────────────
  // These run inside pi's event system (ExtensionRunner.emit catches errors).
  // No try/catch needed — if broadcast() has a bug, pi will report it via
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
  // pi catches errors from this handler.
  pi.on("session_shutdown", async () => {
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── Broadcast to all connected clients ──────────────────────
  // Called from pi.on() handlers (errors caught by pi) and from
  // nowhere else. ws.send() only throws if readyState != OPEN,
  // so the readyState guard prevents the only known throw path.
  function broadcast(payload: AgentEvent): void {
    if (!wss) return;
    const msg = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ── Hypivisor connection with reconnect loop ────────────────
  // Runs from session_start (pi-caught) on first call, then from
  // setTimeout (Node event-loop) on reconnects. The setTimeout path
  // needs protection.
  function connectToHypivisor(port: number): void {
    const url = hypiToken
      ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
      : hypivisorUrl;

    // new WebSocket(url) can throw synchronously on invalid URL.
    // This is an expected error when HYPIVISOR_WS is misconfigured.
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logError("connectToHypivisor: invalid URL", err);
      scheduleReconnect(port);
      return;
    }
    hypivisorWs = ws;

    // --- Node event-loop boundary: open handler ---
    ws.on("open", () => {
      // ws.send throws if readyState != OPEN (race with immediate close).
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
      // Expected: hypivisor went down or network dropped. Reconnect.
      scheduleReconnect(port);
    });

    ws.on("error", () => {
      // Expected: connection refused, network error. close event follows.
    });
  }

  // --- Node event-loop boundary: setTimeout callback ---
  function scheduleReconnect(port: number): void {
    setTimeout(() => {
      try {
        connectToHypivisor(port);
      } catch (err) {
        // WebSocket constructor threw — bad URL or similar. Log and retry.
        logError("scheduleReconnect: connectToHypivisor threw", err);
        scheduleReconnect(port);
      }
    }, reconnectMs);
  }
}
