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
} from "hyper-pi-protocol";
