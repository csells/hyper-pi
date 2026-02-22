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

/** A rendered chat message in the Pi-DE UI */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Hypivisor WebSocket connection status */
export type HypivisorStatus = "connecting" | "connected" | "disconnected" | "error";

/** Agent WebSocket connection status */
export type AgentStatus = "connecting" | "connected" | "disconnected" | "offline";

// ── WebSocket Message Types ───────────────────────────────────

/** Events sent from pi-socket to clients */
export type AgentEvent =
  | InitStateEvent
  | DeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | MessageStartEvent
  | MessageEndEvent;

export interface InitStateEvent {
  type: "init_state";
  events: HistoryEvent[];
  tools: Tool[];
  truncated?: boolean;
  totalEvents?: number;
}

export interface DeltaEvent {
  type: "delta";
  text: string;
}

export interface ToolStartEvent {
  type: "tool_start";
  name: string;
  args: unknown;
}

export interface ToolEndEvent {
  type: "tool_end";
  name: string;
  isError: boolean;
}

export interface MessageStartEvent {
  type: "message_start";
  role: string;
}

export interface MessageEndEvent {
  type: "message_end";
  role: string;
}

/** Individual history events inside init_state.events */
export type HistoryEvent =
  | { type: "user_message"; text: string }
  | DeltaEvent
  | ToolStartEvent
  | ToolEndEvent;

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
