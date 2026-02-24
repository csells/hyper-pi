/**
 * Types for Pi-DE.
 *
 * All shared wire protocol types live in hyper-pi-protocol. This file
 * re-exports them so existing imports continue to work.
 */
export type {
  NodeInfo,
  ToolInfo as Tool,
  InitStateEvent,
  SocketEvent,
  HypivisorStatus,
  AgentStatus,
  HypivisorEvent,
  RpcResponse,
  FetchHistoryRequest,
  HistoryPageResponse,
} from "hyper-pi-protocol";

// Abort request type for canceling agent work
export interface AbortRequest {
  type: "abort";
}
