/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and registers with the hypivisor.
 *
 * CRITICAL SAFETY INVARIANT: No exception may ever escape this extension.
 * Every async handler, every ws.send(), every callback MUST be wrapped in
 * try/catch. An unhandled rejection or uncaught exception inside a pi
 * extension will terminate the host pi process (Node.js v22+ behavior).
 * Requirement R-PS-18: "Network disconnections MUST NOT affect the running
 * pi agent process in any way."
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

  const startPort = parseInt(process.env.PI_SOCKET_PORT || "8080", 10);
  const reconnectMs = parseInt(process.env.PI_SOCKET_RECONNECT_MS || "5000", 10);
  const hypivisorUrl = process.env.HYPIVISOR_WS || "ws://localhost:31415/ws";
  const hypiToken = process.env.HYPI_TOKEN || "";

  // ── Safe send: NEVER throws ────────────────────────────────
  function safeSend(ws: WebSocket, data: string): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    } catch {
      // Swallowed intentionally — R-PS-18: never crash the host process
    }
  }

  // ── Startup ─────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    try {
      const port = await portfinder.getPortPromise({ port: startPort });
      wss = new WebSocketServer({ port });

      wss.on("connection", (ws) => {
        try {
          const initPayload = buildInitState(
            ctx.sessionManager.getBranch(),
            pi.getAllTools(),
          );
          safeSend(ws, JSON.stringify(initPayload));
        } catch {
          // Malformed session data or serialization failure — skip init
        }

        ws.on("message", (data) => {
          try {
            const text = data.toString();
            if (ctx.isIdle()) {
              pi.sendUserMessage(text);
            } else {
              pi.sendUserMessage(text, { deliverAs: "followUp" });
            }
          } catch {
            // pi.sendUserMessage failed — do not crash
          }
        });

        ws.on("error", () => {});
      });

      wss.on("error", () => {});

      connectToHypivisor(port);
    } catch {
      // portfinder or WebSocketServer failed — extension is inert but pi lives
    }
  });

  // ── Event broadcasting ──────────────────────────────────────
  // None of these handlers are async (no await needed), so they are
  // declared as plain functions. A synchronous throw inside a non-async
  // handler still needs try/catch to prevent an uncaughtException.

  pi.on("message_update", (event) => {
    try {
      if (event.assistantMessageEvent?.type === "text_delta") {
        broadcast({ type: "delta", text: event.assistantMessageEvent.delta });
      }
    } catch {
      // never crash the host
    }
  });

  pi.on("tool_execution_start", (event) => {
    try {
      broadcast({ type: "tool_start", name: event.toolName, args: event.args });
    } catch {
      // never crash the host
    }
  });

  pi.on("tool_execution_end", (event) => {
    try {
      broadcast({ type: "tool_end", name: event.toolName, isError: event.isError });
    } catch {
      // never crash the host
    }
  });

  pi.on("message_start", (event) => {
    try {
      broadcast({ type: "message_start", role: event.message.role });
    } catch {
      // never crash the host
    }
  });

  pi.on("message_end", (event) => {
    try {
      broadcast({ type: "message_end", role: event.message.role });
    } catch {
      // never crash the host
    }
  });

  // ── Shutdown ────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    try { if (wss) wss.close(); } catch {}
    try { if (hypivisorWs) hypivisorWs.close(); } catch {}
  });

  // ── Broadcast to all connected clients ──────────────────────
  function broadcast(payload: AgentEvent): void {
    const server = wss;
    if (!server) return;

    let msg: string;
    try {
      msg = JSON.stringify(payload);
    } catch {
      return; // circular ref or non-serializable — skip this event
    }

    const clients = Array.from(server.clients);
    for (const client of clients) {
      safeSend(client, msg);
    }
  }

  // ── Hypivisor connection with reconnect loop ────────────────
  function connectToHypivisor(port: number): void {
    try {
      const url = hypiToken
        ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
        : hypivisorUrl;

      const ws = new WebSocket(url);
      hypivisorWs = ws;

      ws.on("open", () => {
        try {
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
          safeSend(ws, JSON.stringify(rpc));
        } catch {
          // registration failed — will retry on reconnect
        }
      });

      ws.on("close", () => {
        scheduleReconnect(port);
      });

      ws.on("error", () => {});
    } catch {
      scheduleReconnect(port);
    }
  }

  function scheduleReconnect(port: number): void {
    setTimeout(() => {
      try {
        connectToHypivisor(port);
      } catch {
        // constructor threw — try again later
        scheduleReconnect(port);
      }
    }, reconnectMs);
  }
}
