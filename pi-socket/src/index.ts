/**
 * pi-socket: Hyper-Pi WebSocket extension for the pi coding agent
 *
 * Exposes each pi CLI instance via a local WebSocket server, broadcasts
 * agent events in real time, and optionally registers with the hypivisor.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import portfinder from "portfinder";
import os from "node:os";
import { buildInitState } from "./history.js";
import { log } from "./log.js";
import type { AgentEvent, RpcRequest } from "./types.js";

export default function piSocket(pi: ExtensionAPI) {
  const nodeId = `${os.hostname()}-${Math.random().toString(36).substring(2, 8)}`;
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
    ctx.ui.notify(`[pi-socket] ws://localhost:${port}`, "info");
    log.info("WebSocket server started", { port, nodeId });

    wss.on("connection", (ws) => {
      log.info("Client connected");
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

      ws.on("error", (err) => {
        log.error("Client WebSocket error", err);
      });
    });

    wss.on("error", (err) => {
      log.error("WebSocket server error", err);
    });

    connectToHypivisor(port, ctx);
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
    log.info("Session shutting down");
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
  });

  // ── Broadcast to all connected clients (snapshot to avoid race) ─
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
  function connectToHypivisor(port: number, ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) {
    const url = hypiToken
      ? `${hypivisorUrl}?token=${encodeURIComponent(hypiToken)}`
      : hypivisorUrl;

    try {
      hypivisorWs = new WebSocket(url);
    } catch (err) {
      log.error("Failed to create hypivisor WebSocket", err);
      scheduleReconnect(port, ctx);
      return;
    }

    hypivisorWs.on("open", () => {
      ctx.ui.notify("[pi-socket] Connected to hypivisor", "info");
      log.info("Connected to hypivisor", { url: hypivisorUrl });

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

    hypivisorWs.on("close", (code) => {
      log.warn("Hypivisor connection closed", { code });
      scheduleReconnect(port, ctx);
    });

    hypivisorWs.on("error", (err) => {
      log.error("Hypivisor WebSocket error", err);
    });
  }

  function scheduleReconnect(port: number, ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) {
    log.info("Scheduling hypivisor reconnect", { delayMs: reconnectMs });
    setTimeout(() => connectToHypivisor(port, ctx), reconnectMs);
  }
}
