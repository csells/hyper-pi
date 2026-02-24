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
import type { InitStateEvent, SocketEvent, Tool, HistoryPageResponse, CommandInfo, FileInfo, AttachFileResponse } from "./types";

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

  // Pagination state for infinite scroll
  hasMore: boolean = true;
  oldestIndex: number = 0;

  // Callbacks for special events (allows useAgent to react to these)
  onInitState: ((event: InitStateEvent) => void) | null = null;
  onHistoryPage: ((page: HistoryPageResponse) => void) | null = null;
  onError: ((error: string) => void) | null = null;
  onCommandsList: ((commands: CommandInfo[]) => void) | null = null;
  onFilesList: ((files: FileInfo[], cwd: string) => void) | null = null;
  onAttachFileAck: ((ack: AttachFileResponse) => void) | null = null;

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
      let data: SocketEvent;
      try {
        data = JSON.parse(event.data as string) as SocketEvent;
      } catch (e) {
        console.error("[RemoteAgent] Failed to parse WebSocket message:", e);
        return;
      }
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
    this.hasMore = true;
    this.oldestIndex = 0;
  }

  /** Reset state for a new agent connection. */
  reset(): void {
    this.disconnect();
  }

  // ── Agent API surface used by AgentInterface ──────────────────

  async prompt(message: AgentMessage | string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[RemoteAgent] Cannot send message: WebSocket is not connected");
      return;
    }
    const text = typeof message === "string" ? message : (message as UserMessage).content;
    if (typeof text === "string") {
      this.ws.send(text);
    }
  }

  /**
   * Request older messages for infinite scroll pagination.
   * Sends a JSON fetch_history request over the WebSocket.
   */
  fetchHistory(before: number, limit: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[RemoteAgent] Cannot fetch history: WebSocket is not connected");
      return;
    }
    const request = JSON.stringify({ type: "fetch_history", before, limit });
    this.ws.send(request);
  }

  abort(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "abort" }));
  }

  /**
   * Request a list of available commands for / autocomplete.
   */
  listCommands(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "list_commands" }));
  }

  /**
   * Request a list of files matching the given prefix for @ autocomplete.
   * If prefix is not provided, returns files in the current directory.
   */
  listFiles(prefix?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "list_files", prefix }));
  }

  /**
   * Attach a file to the next message.
   * Encodes the file content as base64 and sends an attach_file request.
   */
  attachFile(filename: string, content: ArrayBuffer, mimeType?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(content);
    const binaryString = String.fromCharCode(...Array.from(bytes));
    const base64 = btoa(binaryString);
    this.ws.send(JSON.stringify({
      type: "attach_file",
      filename,
      content: base64,
      mimeType,
    }));
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
    if ("error" in event && typeof (event as { error: string }).error === "string") {
      if (this.onError) {
        this.onError((event as { error: string }).error);
      }
      return;
    }

    // After error check, event is a SocketEvent
    const socketEvent = event as SocketEvent;

    if (socketEvent.type === "init_state") {
      this.handleInitState(socketEvent as InitStateEvent);
      return;
    }

    // Handle history_page responses for infinite scroll
    if (socketEvent.type === "history_page") {
      const page = socketEvent as HistoryPageResponse;
      this._state = { ...this._state, messages: [...page.messages, ...this._state.messages] };
      this.hasMore = page.hasMore;
      this.oldestIndex = page.oldestIndex;
      if (this.onHistoryPage) {
        this.onHistoryPage(page);
      }
      this.emit({ type: "agent_end", messages: this._state.messages });
      return;
    }

    // Handle commands_list response for / autocomplete
    if (socketEvent.type === "commands_list") {
      const event = socketEvent as any;
      if (this.onCommandsList && event.commands) {
        this.onCommandsList(event.commands);
      }
      return;
    }

    // Handle files_list response for @ autocomplete
    if (socketEvent.type === "files_list") {
      const event = socketEvent as any;
      if (this.onFilesList && event.files && event.cwd) {
        this.onFilesList(event.files, event.cwd);
      }
      return;
    }

    // Handle attach_file_ack response
    if (socketEvent.type === "attach_file_ack") {
      const ack = socketEvent as AttachFileResponse;
      if (this.onAttachFileAck) {
        this.onAttachFileAck(ack);
      }
      return;
    }

    // All other events are native AgentEvents — forward directly.
    // Update local state to keep AgentInterface's state reads consistent.
    const agentEvent = socketEvent as AgentEvent;
    switch (agentEvent.type) {
      case "message_start":
        this._state = {
          ...this._state,
          messages: [...this._state.messages, agentEvent.message],
          isStreaming: agentEvent.message.role === "assistant",
          streamMessage: agentEvent.message.role === "assistant" ? agentEvent.message : null,
        };
        break;

      case "message_update":
        // The event contains the full updated message — replace the last one
        this._state = {
          ...this._state,
          streamMessage: agentEvent.message,
        };
        break;

      case "message_end":
        // Finalize: update the last message in the array with the final version
        this._state = {
          ...this._state,
          messages: [
            ...this._state.messages.slice(0, -1),
            agentEvent.message,
          ],
          streamMessage: null,
          // Keep streaming if there are pending tool calls
          isStreaming: this._state.pendingToolCalls.size > 0,
        };
        break;

      case "tool_execution_start":
        {
          const pending = new Set(this._state.pendingToolCalls);
          pending.add(agentEvent.toolCallId);
          this._state = { ...this._state, isStreaming: true, pendingToolCalls: pending };
        }
        break;

      case "tool_execution_end":
        {
          const pending = new Set(this._state.pendingToolCalls);
          pending.delete(agentEvent.toolCallId);
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

    this.emit(agentEvent);
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
    // Initialize pagination state: oldestIndex is current message count (next fetch starts before this)
    this.oldestIndex = event.messages.length;
    this.hasMore = event.truncated ?? false;
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
