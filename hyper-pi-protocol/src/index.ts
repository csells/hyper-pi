/**
 * hyper-pi-protocol: Shared wire protocol types for hyper-pi.
 *
 * Single source of truth for all types exchanged between pi-socket,
 * pi-de, and the hypivisor. Both pi-socket and pi-de import from here
 * instead of maintaining duplicate definitions.
 */
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";

// ── Agent Wire Protocol (pi-socket ↔ pi-de) ──────────────────

/** Tool metadata returned by pi.getAllTools() */
export interface ToolInfo {
  name: string;
  description: string;
}

/**
 * Sent once when a client connects, containing the full conversation
 * history as proper AgentMessage objects (no lossy conversion).
 */
export interface InitStateEvent {
  type: "init_state";
  messages: AgentMessage[];
  tools: ToolInfo[];
  truncated?: boolean;
  totalMessages?: number;
}

/**
 * Client request to fetch older messages for infinite scroll.
 * Sent as JSON over WebSocket; server responds with HistoryPageResponse.
 */
export interface FetchHistoryRequest {
  type: "fetch_history";
  before: number;  // message index — fetch messages before this index
  limit: number;   // max messages to return
}

/**
 * Server response to a fetch_history request.
 * Contains a slice of older messages ready to prepend to the conversation.
 */
export interface HistoryPageResponse {
  type: "history_page";
  messages: AgentMessage[];
  hasMore: boolean;        // true if older messages exist before this page
  oldestIndex: number;     // index of the oldest message in this page
}

/**
 * Wire protocol from pi-socket: either init_state or a forwarded pi AgentEvent.
 * pi-socket forwards events as-is — no custom decomposition.
 */
export type SocketEvent = InitStateEvent | AgentEvent | HistoryPageResponse;

// ── Hypivisor Registry Protocol ───────────────────────────────

/** A registered pi agent node in the hypivisor registry */
export interface NodeInfo {
  id: string;
  machine: string;
  cwd: string;
  port: number;
  status: "active" | "offline";
}

/** Hypivisor WebSocket connection status */
export type HypivisorStatus = "connecting" | "connected" | "disconnected" | "error";

/** Agent WebSocket connection status */
export type AgentStatus = "connecting" | "connected" | "disconnected" | "offline";

// ── Hypivisor Push Events ─────────────────────────────────────

export type HypivisorEvent =
  | { event: "init"; nodes: NodeInfo[]; protocol_version: string }
  | { event: "node_joined"; node: NodeInfo }
  | { event: "node_offline"; id: string }
  | { event: "node_removed"; id: string };

// ── JSON-RPC ──────────────────────────────────────────────────

/** JSON-RPC envelope sent to hypivisor */
export interface RpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/** JSON-RPC response from hypivisor */
export interface RpcResponse {
  id: string;
  result?: unknown;
  error?: string;
}

// Re-export pi-agent-core types that consumers need
export type { AgentEvent, AgentMessage };
