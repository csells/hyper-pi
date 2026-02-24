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
import fs from "node:fs";
import path from "node:path";
import { buildInitState, getHistoryPage } from "./history.js";
import { boundary } from "./safety.js";
import * as log from "./log.js";
import type { RpcRequest, FetchHistoryRequest, AbortRequest, ListCommandsRequest, CommandInfo, CommandsListResponse, ListFilesRequest, FileInfo, FilesListResponse, AttachFileRequest, AttachFileResponse } from "./types.js";

export default function piSocket(pi: ExtensionAPI) {
  let nodeId = process.pid.toString(); // fallback until session provides UUID
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;
  let hypivisorUrlValid = true;
  let hypivisorConnected = false;
  let reconnectDelay = 0;
  let shutdownRequested = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

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
    shutdownRequested = false;

    // Close previous WSS if session restarts — prevents stale port registrations
    if (wss) {
      wss.close();
      wss = null;
    }

    // Tear down previous hypivisor connection to prevent ghost registrations.
    // Without this, session restarts leak orphaned WebSocket connections whose
    // close handlers trigger reconnect loops with stale node IDs.
    teardownHypivisor();

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

        // Reject empty/whitespace messages — sending these to pi triggers
        // an Anthropic API call that fails with "messages: at least one
        // message is required", and that error becomes a permanent
        // conversation message in pi's TUI that we cannot remove.
        if (!text.trim()) {
          log.warn("pi-socket", "ignoring empty WebSocket message");
          return;
        }

        // Try to detect fetch_history JSON requests
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }

        // Handle fetch_history requests
        if (parsed && typeof parsed === "object" && (parsed as any).type === "fetch_history") {
          const req = parsed as FetchHistoryRequest;
          const page = getHistoryPage(ctx.sessionManager.getBranch(), req.before, req.limit);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(safeSerialize(page));
          }
          return;
        }

        // Handle abort requests
        if (parsed && typeof parsed === "object" && (parsed as any).type === "abort") {
          log.info("pi-socket", "abort requested by client");
          ctx.abort();
          return;
        }

        // Handle list_commands requests — returns slash commands (/, /help, /skill:xxx)
        if (parsed && typeof parsed === "object" && (parsed as any).type === "list_commands") {
          const slashCommands = pi.getCommands();
          const commands: CommandInfo[] = slashCommands.map(c => ({
            name: `/${c.name}`,
            description: c.description ?? "",
          }));
          const response: CommandsListResponse = { type: "commands_list", commands };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(safeSerialize(response));
          }
          return;
        }

        // Handle list_files requests
        if (parsed && typeof parsed === "object" && (parsed as any).type === "list_files") {
          const req = parsed as ListFilesRequest;
          const cwd = process.cwd();
          const targetDir = req.prefix 
            ? path.resolve(cwd, path.dirname(req.prefix))
            : cwd;
          
          // Security check: ensure targetDir is within cwd (prevent path traversal)
          if (!targetDir.startsWith(cwd)) {
            // Escape attempt detected - clamp to cwd
            const response: FilesListResponse = { type: "files_list", files: [], cwd };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(safeSerialize(response));
            }
            return;
          }
          
          // Read directory entries safely
          let files: FileInfo[] = [];
          try {
            const entries = fs.readdirSync(targetDir, { withFileTypes: true });
            
            // Filter and map entries
            for (const entry of entries) {
              // Skip hidden files (starting with .)
              if (entry.name.startsWith(".")) {
                continue;
              }
              
              files.push({
                path: path.relative(cwd, path.join(targetDir, entry.name)),
                isDirectory: entry.isDirectory(),
              });
              
              // Limit to ~100 entries to avoid huge payloads
              if (files.length >= 100) {
                break;
              }
            }
          } catch {
            // Directory doesn't exist or is unreadable - return empty array
            files = [];
          }
          
          const response: FilesListResponse = { type: "files_list", files, cwd };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(safeSerialize(response));
          }
          return;
        }

        // Handle file attachment requests
        if (parsed && typeof parsed === "object" && (parsed as any).type === "attach_file") {
          const req = parsed as AttachFileRequest;
          const ack: AttachFileResponse = {
            type: "attach_file_ack",
            filename: req.filename,
            success: false,
          };

          // Validate filename
          if (!req.filename || typeof req.filename !== "string") {
            ack.error = "filename is required";
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(safeSerialize(ack));
            }
            return;
          }

          // Validate content
          if (!req.content || typeof req.content !== "string") {
            ack.error = "content is required";
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(safeSerialize(ack));
            }
            return;
          }

          // Check file size: reject files > 10MB
          const estimatedBytes = Buffer.byteLength(req.content, "utf-8");
          const maxBytes = 10 * 1024 * 1024; // 10MB
          if (estimatedBytes > maxBytes) {
            ack.error = `file too large (${Math.round(estimatedBytes / 1024 / 1024)}MB > 10MB)`;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(safeSerialize(ack));
            }
            return;
          }

          try {
            // Decode base64 content
            const decodedBytes = Buffer.from(req.content, "base64");
            const isImage = req.mimeType && req.mimeType.startsWith("image/");

            // Build content array for sendUserMessage
            const content: any[] = [];

            if (isImage && req.mimeType) {
              // Image: add as ImageContent with base64 data
              content.push({
                type: "image",
                data: req.content,
                mimeType: req.mimeType,
              } as any);
            } else {
              // Text: add as TextContent with filename prefix for context
              const text = decodedBytes.toString("utf-8");
              content.push({
                type: "text",
                text: `[File: ${req.filename}]\n${text}`,
              } as any);
            }

            // Send via sendUserMessage with deliverAs appropriate based on agent idle state
            try {
              if (ctx.isIdle()) {
                pi.sendUserMessage(content);
              } else {
                pi.sendUserMessage(content, { deliverAs: "followUp" });
              }
              ack.success = true;
              log.info("pi-socket", "file attached", { filename: req.filename, bytes: estimatedBytes });
            } catch (err) {
              ack.error = `failed to attach file: ${String(err)}`;
              log.error("attach_file.sendUserMessage", err);
            }
          } catch (err) {
            ack.error = `failed to decode file: ${String(err)}`;
            log.error("attach_file.decode", err);
          }

          // Send ack back to client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(safeSerialize(ack));
          }
          return;
        }

        // Plain text prompt — existing logic unchanged
        // Wrap in try/catch so that ANY error from sendUserMessage is
        // logged to our JSONL file and NEVER propagates into pi's output.
        // pi.sendUserMessage() returns void (fire-and-forget); if it throws
        // synchronously the error would bubble through boundary() into
        // log.error, but we catch here with a specific boundary name for
        // traceability.
        try {
          if (ctx.isIdle()) {
            pi.sendUserMessage(text);
          } else {
            pi.sendUserMessage(text, { deliverAs: "followUp" });
          }
        } catch (err) {
          log.error("sendUserMessage", err);
        }
      }));

      ws.on("close", () => {
        log.info("pi-socket", "client disconnected");
      });

      ws.on("error", (err) => {
        log.warn("pi-socket", "client WebSocket error", { error: String(err) });
      });
    }));

    wss.on("error", (err) => {
      log.error("wss.error", err);
    });
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
    shutdownRequested = true;

    // Cancel any pending reconnect/heartbeat to prevent post-shutdown activity
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Deregister from hypivisor and wait for the message to flush before closing.
    // Without the send callback, ws.close() can race the deregister frame.
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const ws = hypivisorWs;
      hypivisorWs = null;
      ws.removeAllListeners("close"); // prevent close → reconnect
      const rpc: RpcRequest = {
        id: "dereg",
        method: "deregister",
        params: { id: nodeId },
      };
      await new Promise<void>((resolve) => {
        ws.send(JSON.stringify(rpc), () => resolve());
        setTimeout(resolve, 1000); // timeout in case send callback never fires
      });
      ws.close();
    } else if (hypivisorWs) {
      hypivisorWs.removeAllListeners("close");
      hypivisorWs.close();
      hypivisorWs = null;
    }
    if (wss) wss.close();
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

  // ── Hypivisor lifecycle ──────────────────────────────────────

  /** Cleanly close the hypivisor WebSocket and cancel any pending reconnect/heartbeat. */
  function teardownHypivisor(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (hypivisorWs) {
      const oldWs = hypivisorWs;
      hypivisorWs = null;
      oldWs.removeAllListeners(); // prevent close → reconnect
      oldWs.close();
    }
    hypivisorConnected = false;
    reconnectDelay = 0;
  }

  /**
   * Connect to the hypivisor for registry/monitoring. This connection is
   * strictly OPTIONAL — if the hypivisor is unreachable, crashes, or is
   * killed, the pi agent MUST continue operating normally. Only the
   * dashboard loses visibility into this agent.
   */
  function connectToHypivisor(port: number): void {
    if (!hypivisorUrlValid || shutdownRequested) return;

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
          pid: process.pid,
        },
      };
      ws.send(JSON.stringify(rpc));
      hypivisorConnected = true;
      reconnectDelay = 0;
      log.info("hypivisor", "registered", { nodeId, port });

      // Start heartbeat so hypivisor can detect dead connections via last_seen
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30_000);
    }));

    // ── CRITICAL INVARIANT ──────────────────────────────────────
    // The hypivisor is an OPTIONAL monitoring layer. If it crashes,
    // becomes unreachable, or is killed, the pi agent process MUST
    // continue running unaffected. These handlers are wrapped in
    // boundary() so that even an unanticipated error in close/error
    // handling can NEVER propagate to the pi host process.
    // ─────────────────────────────────────────────────────────────
    ws.on("close", boundary("hypivisor.close", () => {
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      const wasConnected = hypivisorConnected;
      hypivisorConnected = false;
      if (wasConnected) {
        log.warn("hypivisor", "disconnected, will reconnect");
      } else {
        log.warn("hypivisor", "connection attempt failed, will retry");
      }
      scheduleReconnect(port);
    }));

    ws.on("error", boundary("hypivisor.error", (err: Error) => {
      log.warn("hypivisor", "connection error", { error: String(err) });
    }));
  }

  function scheduleReconnect(port: number): void {
    if (shutdownRequested) return;
    reconnectDelay = reconnectDelay === 0
      ? reconnectMs
      : Math.min(reconnectDelay * 2, reconnectMaxMs);
    reconnectTimer = setTimeout(boundary("reconnect", () => {
      reconnectTimer = null;
      connectToHypivisor(port);
    }), reconnectDelay);
  }
}

// ── Safe serializer ──────────────────────────────────────────
function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    log.error("safeSerialize", err);
    try {
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === "bigint") return val.toString();
        if (typeof val === "function") return undefined;
        return val;
      });
    } catch (err2) {
      log.error("safeSerialize", err2);
      return '{"type":"error","message":"non-serializable event"}';
    }
  }
}
