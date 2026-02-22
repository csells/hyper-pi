/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and registers with the hypivisor.
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

  // ── Startup ─────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const port = await portfinder.getPortPromise({ port: startPort });
    wss = new WebSocketServer({ port });

    wss.on("connection", (ws) => {
      const initPayload = buildInitState(
        ctx.sessionManager.getBranch(),
        pi.getAllTools(),
      );
      ws.send(JSON.stringify(initPayload));

      ws.on("message", (data) => {
        const text = data.toString();
        if (ctx.isIdle()) {
          pi.sendUserMessage(text);
        } else {
          pi.sendUserMessage(text, { deliverAs: "followUp" });
        }
      });

      ws.on("error", () => {});
    });

    wss.on("error", () => {});

    connectToHypivisor(port);
  });

  // ── Event broadcasting ──────────────────────────────────────
  pi.on("message_update", async (event) => {
    if (event.assistantMessageEvent?.type === "text_delta") {
      broadcast({ type: "delta", text: event.assistantMessageEvent.delta });
    }
  });

  pi.on("tool_execution_start", async (event) => {
    broadcast({ type: "tool_start", name: event.toolName, args: event.args });
  });

  pi.on("tool_execution_end", async (event) => {
    broadcast({ type: "tool_end", name: event.toolName, isError: event.isError });
  });

  pi.on("message_start", async (event) => {
    broadcast({ type: "message_start", role: event.message.role });
  });

  pi.on("message_end", async (event) => {
    broadcast({ type: "message_end", role: event.message.role });
  });

  // ── Shutdown ────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── Broadcast to all connected clients ──────────────────────
  function broadcast(payload: AgentEvent) {
    if (!wss) return;
    const msg = JSON.stringify(payload);
    const clients = Array.from(wss.clients);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ── Hypivisor connection with reconnect loop ────────────────
  function connectToHypivisor(port: number) {
    const url = hypiToken
      ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
      : hypivisorUrl;

    try {
      hypivisorWs = new WebSocket(url);
    } catch {
      scheduleReconnect(port);
      return;
    }

    hypivisorWs.on("open", () => {
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
      hypivisorWs!.send(JSON.stringify(rpc));
    });

    hypivisorWs.on("close", () => {
      scheduleReconnect(port);
    });

    hypivisorWs.on("error", () => {});
  }

  function scheduleReconnect(port: number) {
    setTimeout(() => connectToHypivisor(port), reconnectMs);
  }
}
