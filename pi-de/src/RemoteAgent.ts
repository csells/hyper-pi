/**
 * RemoteAgent: Duck-types the pi-agent-core Agent interface for use with
 * @mariozechner/pi-web-ui components over a pi-socket WebSocket connection.
 *
 * ## Key design: pass-through, not reconstruction
 *
 * pi-socket forwards pi's native AgentEvent objects directly over WebSocket.
 * RemoteAgent just parses them and emits — no stateful reconstruction of
 * assistant messages, tool calls, or content blocks. The events already
 * contain the full AgentMessage objects that AgentInterface needs.
 */
import type {
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentTool,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type {
  Model,
  Api,
  ImageContent,
  TextContent,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { InitStateEvent, SocketEvent, Tool } from "./types";

/** Minimal Model stub for display purposes (remote agent owns the real model). */
const REMOTE_MODEL = {
  provider: "anthropic",
  api: "anthropic-messages",
  id: "remote",
  name: "Remote Agent",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
} satisfies Model<"anthropic-messages">;

type Listener = (e: AgentEvent) => void;

export class RemoteAgent {
  private _state: AgentState;
  private listeners: Set<Listener> = new Set();
  private ws: WebSocket | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  // Callbacks for special events (allows useAgent to react to these)
  onInitState: ((event: InitStateEvent) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  // Required by AgentInterface (prevents it from overriding with proxy/key defaults)
  streamFn: unknown = () => {};
  getApiKey: unknown = () => undefined;

  constructor() {
    this._state = {
      systemPrompt: "",
      model: REMOTE_MODEL,
      thinkingLevel: "off" as ThinkingLevel,
      tools: [],
      messages: [],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set<string>(),
    };
  }

  get state(): AgentState {
    return this._state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    // If we already have messages (init_state arrived before subscription),
    // emit agent_end so the subscriber renders the current state immediately.
    if (this._state.messages.length > 0) {
      queueMicrotask(() => fn({ type: "agent_end", messages: this._state.messages }));
    }
    return () => this.listeners.delete(fn);
  }

  private emit(event: AgentEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  /** Connect to a pi-socket agent WebSocket and start processing events. */
  connect(ws: WebSocket): void {
    // Clean up any existing listener before adding a new one
    this.disconnect();
    
    this.ws = ws;
    this.messageHandler = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string) as SocketEvent;
      this.handleSocketEvent(data);
    };
    ws.addEventListener("message", this.messageHandler);
  }

  /** Disconnect from the current WebSocket (does not close it). */
  disconnect(): void {
    // Remove the event listener from the old WebSocket before nulling it
    if (this.ws && this.messageHandler) {
      this.ws.removeEventListener("message", this.messageHandler);
    }
    this.ws = null;
    this.messageHandler = null;
    this._state = {
      ...this._state,
      messages: [],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    };
  }

  /** Reset state for a new agent connection. */
  reset(): void {
    this.disconnect();
  }

  // ── Agent API surface used by AgentInterface ──────────────────

  async prompt(message: AgentMessage | string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text = typeof message === "string" ? message : (message as UserMessage).content;
    if (typeof text === "string") {
      this.ws.send(text);
    }
  }

  abort(): void {
    // Remote agents don't support abort from the web UI
  }

  setModel(_m: Model<Api>): void {
    // No-op: remote agent owns its model
  }

  setThinkingLevel(_l: ThinkingLevel): void {
    // No-op: remote agent owns its thinking level
  }

  setTools(_t: AgentTool[]): void {
    // No-op
  }

  // ── Socket event handling ─────────────────────────────────────

  private handleSocketEvent(event: SocketEvent | { error: string }): void {
    // Check for proxy error messages (e.g., agent not found)
    if ("error" in event && typeof event.error === "string") {
      if (this.onError) {
        this.onError(event.error);
      }
      return;
    }

    if (event.type === "init_state") {
      this.handleInitState(event as InitStateEvent);
      return;
    }

    // All other events are native AgentEvents — forward directly.
    // Update local state to keep AgentInterface's state reads consistent.
    switch (event.type) {
      case "message_start":
        this._state = {
          ...this._state,
          messages: [...this._state.messages, event.message],
          isStreaming: event.message.role === "assistant",
          streamMessage: event.message.role === "assistant" ? event.message : null,
        };
        break;

      case "message_update":
        // The event contains the full updated message — replace the last one
        this._state = {
          ...this._state,
          streamMessage: event.message,
        };
        break;

      case "message_end":
        // Finalize: update the last message in the array with the final version
        this._state = {
          ...this._state,
          messages: [
            ...this._state.messages.slice(0, -1),
            event.message,
          ],
          streamMessage: null,
          // Keep streaming if there are pending tool calls
          isStreaming: this._state.pendingToolCalls.size > 0,
        };
        break;

      case "tool_execution_start":
        {
          const pending = new Set(this._state.pendingToolCalls);
          pending.add(event.toolCallId);
          this._state = { ...this._state, isStreaming: true, pendingToolCalls: pending };
        }
        break;

      case "tool_execution_end":
        {
          const pending = new Set(this._state.pendingToolCalls);
          pending.delete(event.toolCallId);
          this._state = {
            ...this._state,
            pendingToolCalls: pending,
            isStreaming: pending.size > 0,
          };
        }
        break;

      // tool_execution_update, agent_start, agent_end, turn_start, turn_end
      // — no state updates needed, just emit
    }

    this.emit(event);
  }

  private handleInitState(event: InitStateEvent): void {
    this._state = {
      ...this._state,
      tools: event.tools.map(socketToolToAgentTool),
      messages: event.messages,
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    };
    // Call onInitState callback if provided (allows useAgent to get truncation info)
    if (this.onInitState) {
      this.onInitState(event);
    }
    this.emit({ type: "agent_end", messages: this._state.messages });
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function socketToolToAgentTool(t: Tool): AgentTool {
  return {
    name: t.name,
    label: t.name,
    description: t.description,
    parameters: { type: "object", properties: {} } as never,
    execute: async () => ({ content: [], details: {} }),
  };
}
