import type { AgentEvent as CoreAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";

/** A registered pi agent node in the hypivisor registry */
export interface NodeInfo {
  id: string;
  machine: string;
  cwd: string;
  port: number;
  status: "active" | "offline";
}

/** A tool reported by the pi agent via init_state */
export interface Tool {
  name: string;
  description: string;
}

/** Hypivisor WebSocket connection status */
export type HypivisorStatus = "connecting" | "connected" | "disconnected" | "error";

/** Agent WebSocket connection status */
export type AgentStatus = "connecting" | "connected" | "disconnected" | "offline";

// ── WebSocket Message Types ───────────────────────────────────

/**
 * Sent once when a client connects, containing the full conversation
 * history as proper AgentMessage objects.
 */
export interface InitStateEvent {
  type: "init_state";
  messages: AgentMessage[];
  tools: Tool[];
  truncated?: boolean;
  totalMessages?: number;
}

/**
 * Wire protocol from pi-socket: either init_state or a forwarded pi AgentEvent.
 * pi-socket forwards events as-is — no custom decomposition.
 */
export type SocketEvent = InitStateEvent | CoreAgentEvent;

// ── Hypivisor Push Events ─────────────────────────────────────

export type HypivisorEvent =
  | { event: "init"; nodes: NodeInfo[]; protocol_version: string }
  | { event: "node_joined"; node: NodeInfo }
  | { event: "node_offline"; id: string }
  | { event: "node_removed"; id: string };

// ── JSON-RPC ──────────────────────────────────────────────────

export interface RpcResponse {
  id: string;
  result?: unknown;
  error?: string;
}
