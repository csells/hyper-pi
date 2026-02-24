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
 * Client request to abort the current agent operation.
 * Sent as JSON over WebSocket; server calls ctx.abort() to cancel work.
 */
export interface AbortRequest {
  type: "abort";
}

/**
 * Client request to list available / commands and skills.
 * Sent as JSON over WebSocket; server responds with CommandsListResponse.
 */
export interface ListCommandsRequest {
  type: "list_commands";
}

/**
 * Server response with available / commands and skills.
 * Sent in response to a ListCommandsRequest.
 */
export interface CommandsListResponse {
  type: "commands_list";
  commands: CommandInfo[];
}

/**
 * Information about a single / command or skill.
 */
export interface CommandInfo {
  name: string;        // e.g. "/help", "/reload", "/skill:harden"
  description: string;
}

/**
 * Client request to list files for @ autocomplete.
 * Sent as JSON over WebSocket; server responds with FilesListResponse.
 */
export interface ListFilesRequest {
  type: "list_files";
  prefix?: string;  // partial path to filter/complete
}

/**
 * File information for directory listing.
 */
export interface FileInfo {
  path: string;        // relative to cwd
  isDirectory: boolean;
}

/**
 * Server response with file listings for @ autocomplete.
 * Contains file info in the target directory (or cwd if no prefix).
 */
export interface FilesListResponse {
  type: "files_list";
  files: FileInfo[];
  cwd: string;  // agent's working directory for context
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
export type SocketEvent = InitStateEvent | AgentEvent | HistoryPageResponse | CommandsListResponse | FilesListResponse;

// ── Hypivisor Registry Protocol ───────────────────────────────

/** A registered pi agent node in the hypivisor registry */
export interface NodeInfo {
  id: string;
  machine: string;
  cwd: string;
  port: number;
  status: "active" | "offline";
  pid?: number;
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
