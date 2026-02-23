/**
 * Wire protocol types for pi-socket.
 *
 * The core principle: pi-socket forwards pi's native AgentEvent objects
 * directly over WebSocket. No decomposition, no custom event format.
 * Pi-DE receives them and passes them straight to pi-web-ui's AgentInterface.
 *
 * The only custom event is `init_state`, which sends the current conversation
 * (AgentMessage[]) and tool list when a client connects.
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";

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
 * Wire protocol: either an init_state or a forwarded pi extension event.
 *
 * Extension events are forwarded as-is from pi's event system. They match
 * the AgentEvent type from @mariozechner/pi-agent-core exactly:
 *   - { type: "agent_start" }
 *   - { type: "agent_end", messages: AgentMessage[] }
 *   - { type: "turn_start", ... }
 *   - { type: "turn_end", message: AgentMessage, toolResults: ... }
 *   - { type: "message_start", message: AgentMessage }
 *   - { type: "message_update", message: AgentMessage, assistantMessageEvent: ... }
 *   - { type: "message_end", message: AgentMessage }
 *   - { type: "tool_execution_start", toolCallId, toolName, args }
 *   - { type: "tool_execution_update", toolCallId, toolName, args, partialResult }
 *   - { type: "tool_execution_end", toolCallId, toolName, result, isError }
 *
 * We don't re-declare them here — pi-agent-core owns the types.
 */

/** JSON-RPC envelope sent to hypivisor */
export interface RpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}
