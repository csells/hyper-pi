/**
 * RemoteAgent: Duck-types the pi-agent-core Agent interface for use with
 * @mariozechner/pi-web-ui components over a pi-socket WebSocket connection.
 *
 * The real Agent class drives a local LLM loop. RemoteAgent instead:
 *   - Receives events from a remote pi-socket WebSocket
 *   - Maintains AgentState (messages, isStreaming, tools, pendingToolCalls)
 *   - Emits AgentEvents that AgentInterface subscribes to
 *   - Forwards prompt() calls as WebSocket text messages
 */
import type {
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentTool,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  Api,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type {
  AgentEvent as SocketEvent,
  HistoryEvent,
  InitStateEvent,
  Tool as SocketTool,
} from "./types";

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

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Listener = (e: AgentEvent) => void;

export class RemoteAgent {
  private _state: AgentState;
  private listeners: Set<Listener> = new Set();
  private ws: WebSocket | null = null;

  // Current streaming assistant message being built from deltas
  private streamingMessage: AssistantMessage | null = null;
  private toolCallCounter = 0;
  private toolCallIdMap = new Map<string, string>();
  private toolCallArgBuffers: Map<string, string> | null = null;

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
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as SocketEvent;
      this.handleSocketEvent(data);
    });
  }

  /** Disconnect from the current WebSocket (does not close it). */
  disconnect(): void {
    this.ws = null;
    this._state = {
      ...this._state,
      messages: [],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    };
    this.streamingMessage = null;
    this.toolCallCounter = 0;
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
      // Optimistically add user message to state (pi-socket doesn't echo it back)
      const userMessage: UserMessage = {
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      this._state = {
        ...this._state,
        messages: [...this._state.messages, userMessage],
      };
      this.emit({ type: "message_start", message: userMessage });
      this.emit({ type: "message_end", message: userMessage });

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

  private handleSocketEvent(event: SocketEvent): void {
    switch (event.type) {
      case "init_state":
        this.handleInitState(event as InitStateEvent);
        break;
      case "message_start":
        this.handleMessageStart(event.role, event.content);
        break;
      case "delta":
        this.handleDelta(event.text);
        break;
      case "thinking_delta":
        this.handleThinkingDelta(event.text);
        break;
      case "toolcall_start":
        this.handleToolcallStart(event.name, event.id);
        break;
      case "toolcall_delta":
        this.handleToolcallDelta(event.id, event.argsDelta);
        break;
      case "tool_start":
        this.handleToolStart(event.name, event.args);
        break;
      case "tool_end":
        this.handleToolEnd(event.name, event.isError, event.result);
        break;
      case "message_end":
        this.handleMessageEnd(event.role);
        break;
    }
  }

  private handleInitState(event: InitStateEvent): void {
    // Convert socket tools to AgentTool stubs for display
    this._state = {
      ...this._state,
      tools: event.tools.map(socketToolToAgentTool),
      messages: rebuildMessages(event.events),
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    };
    this.streamingMessage = null;
    this.toolCallCounter = 0;
    this.toolCallIdMap.clear();
    this.toolCallArgBuffers = null;
    this.emit({ type: "agent_end", messages: this._state.messages });
  }

  private handleMessageStart(role: string, content?: string): void {
    if (role === "assistant") {
      this._state = { ...this._state, isStreaming: true };
      this.streamingMessage = makeEmptyAssistant();
      this.emit({ type: "agent_start" });
      this.emit({ type: "turn_start" });
      this.emit({ type: "message_start", message: this.streamingMessage });
    } else if (role === "user" && content) {
      // User message from the TUI — add to state so Pi-DE displays it
      const userMessage: UserMessage = {
        role: "user",
        content,
        timestamp: Date.now(),
      };
      this._state = {
        ...this._state,
        messages: [...this._state.messages, userMessage],
      };
      this.emit({ type: "message_start", message: userMessage });
      this.emit({ type: "message_end", message: userMessage });
    }
  }

  private handleDelta(text: string): void {
    if (!this.streamingMessage) {
      // Delta without a message_start — create one
      this._state = { ...this._state, isStreaming: true };
      this.streamingMessage = makeEmptyAssistant();
      this.emit({ type: "agent_start" });
      this.emit({ type: "turn_start" });
      this.emit({ type: "message_start", message: this.streamingMessage });
    }

    // Append to the last text block, or create one
    const content = this.streamingMessage.content;
    const lastBlock = content[content.length - 1];
    if (lastBlock && lastBlock.type === "text") {
      (lastBlock as TextContent).text += text;
    } else {
      content.push({ type: "text", text });
    }

    const event: AssistantMessageEvent = {
      type: "text_delta",
      contentIndex: content.length - 1,
      delta: text,
      partial: this.streamingMessage,
    };
    this.emit({
      type: "message_update",
      message: this.streamingMessage,
      assistantMessageEvent: event,
    });
  }

  private handleThinkingDelta(text: string): void {
    if (!this.streamingMessage) {
      this._state = { ...this._state, isStreaming: true };
      this.streamingMessage = makeEmptyAssistant();
      this.emit({ type: "agent_start" });
      this.emit({ type: "turn_start" });
      this.emit({ type: "message_start", message: this.streamingMessage });
    }

    // Append to the last thinking block, or create one
    const content = this.streamingMessage.content;
    const lastBlock = content[content.length - 1];
    if (lastBlock && lastBlock.type === "thinking") {
      (lastBlock as ThinkingContent).thinking += text;
    } else {
      content.push({ type: "thinking", thinking: text });
    }

    const event: AssistantMessageEvent = {
      type: "thinking_delta",
      contentIndex: content.length - 1,
      delta: text,
      partial: this.streamingMessage,
    };
    this.emit({
      type: "message_update",
      message: this.streamingMessage,
      assistantMessageEvent: event,
    });
  }

  /**
   * toolcall_start: LLM output a tool call in the assistant message.
   * Fires DURING the streaming message (before message_end).
   * Adds a toolCall content block so pi-web-ui renders it inline.
   */
  private handleToolcallStart(name: string, id: string): void {
    if (!this.streamingMessage) {
      this._state = { ...this._state, isStreaming: true };
      this.streamingMessage = makeEmptyAssistant();
      this.emit({ type: "agent_start" });
      this.emit({ type: "turn_start" });
      this.emit({ type: "message_start", message: this.streamingMessage });
    }

    // Map the pi-native toolCallId to our internal counter for pairing
    this.toolCallIdMap.set(id, id);

    const toolCall: ToolCall = {
      type: "toolCall",
      id,
      name,
      arguments: {},
    };
    this.streamingMessage.content.push(toolCall);

    const pending = new Set(this._state.pendingToolCalls);
    pending.add(id);
    this._state = { ...this._state, pendingToolCalls: pending };

    this.emit({
      type: "message_update",
      message: this.streamingMessage,
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: this.streamingMessage.content.length - 1,
        partial: this.streamingMessage,
      },
    });
  }

  /**
   * toolcall_delta: Incremental arguments JSON for a tool call being streamed.
   */
  private handleToolcallDelta(id: string, argsDelta: string): void {
    if (!this.streamingMessage) return;
    const toolCall = this.streamingMessage.content.find(
      (b): b is ToolCall => b.type === "toolCall" && (b as ToolCall).id === id,
    );
    if (!toolCall) return;

    // Accumulate the raw args JSON string; we'll parse it at tool_start
    if (!this.toolCallArgBuffers) this.toolCallArgBuffers = new Map();
    const existing = this.toolCallArgBuffers.get(id) ?? "";
    this.toolCallArgBuffers.set(id, existing + argsDelta);

    // Try to parse partial JSON into arguments for display
    try {
      toolCall.arguments = JSON.parse(this.toolCallArgBuffers.get(id)!) as Record<string, unknown>;
    } catch {
      // Partial JSON — leave arguments as-is until complete
    }

    this.emit({
      type: "message_update",
      message: this.streamingMessage,
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: this.streamingMessage.content.indexOf(toolCall),
        delta: argsDelta,
        partial: this.streamingMessage,
      },
    });
  }

  /**
   * tool_start: Tool EXECUTION begins (fires after message_end).
   * If toolcall_start already added the block, just mark it pending.
   * Otherwise (history replay), create the block.
   */
  private handleToolStart(name: string, args: unknown): void {
    if (!this.streamingMessage) {
      this._state = { ...this._state, isStreaming: true };
      this.streamingMessage = makeEmptyAssistant();
      this.emit({ type: "agent_start" });
      this.emit({ type: "turn_start" });
    }

    // Check if toolcall_start already added a block for this tool.
    // During live streaming: toolcall_start fires during the message,
    // then tool_start fires after message_end for execution.
    // During history replay: only tool_start fires (no toolcall_start).
    const existing = this.streamingMessage.content.find(
      (b): b is ToolCall =>
        b.type === "toolCall" &&
        (b as ToolCall).name === name &&
        this._state.pendingToolCalls.has((b as ToolCall).id),
    );

    if (existing) {
      // Already added by toolcall_start — just update args and emit execution event
      if (args) existing.arguments = (args as Record<string, unknown>);
      this.emit({
        type: "tool_execution_start",
        toolCallId: existing.id,
        toolName: name,
        args,
      });
      return;
    }

    // History replay path — create the block
    const toolCallId = `tc_${++this.toolCallCounter}`;
    const toolCall: ToolCall = {
      type: "toolCall",
      id: toolCallId,
      name,
      arguments: (args as Record<string, unknown>) ?? {},
    };
    this.streamingMessage.content.push(toolCall);

    const pending = new Set(this._state.pendingToolCalls);
    pending.add(toolCallId);
    this._state = { ...this._state, pendingToolCalls: pending };

    this.emit({
      type: "tool_execution_start",
      toolCallId,
      toolName: name,
      args,
    });

    // Push a message_update so the streaming container re-renders
    this.emit({
      type: "message_update",
      message: this.streamingMessage,
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: this.streamingMessage.content.length - 1,
        partial: this.streamingMessage,
      },
    });
  }

  private handleToolEnd(name: string, isError: boolean, result?: string): void {
    // Find the matching tool call in the streaming message
    const toolCall = this.streamingMessage?.content
      .filter((b): b is ToolCall => b.type === "toolCall" && b.name === name)
      .pop();

    const toolCallId = toolCall?.id ?? `tc_${this.toolCallCounter}`;

    // Remove from pending
    const pending = new Set(this._state.pendingToolCalls);
    pending.delete(toolCallId);
    this._state = { ...this._state, pendingToolCalls: pending };

    // Create a tool result message with actual content
    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId,
      toolName: name,
      content: [{ type: "text", text: result ?? (isError ? "Error" : "Done") }],
      isError,
      timestamp: Date.now(),
    };

    // Add tool result to messages (so MessageList can find it)
    this._state = {
      ...this._state,
      messages: [...this._state.messages, toolResult],
    };

    this.emit({
      type: "tool_execution_end",
      toolCallId,
      toolName: name,
      result: toolResult,
      isError,
    });
  }

  private handleMessageEnd(role: string): void {
    if (role === "assistant" && this.streamingMessage) {
      // Check if any tool calls were made in this message — if so, tools
      // will execute next and a new assistant message will follow.
      const hasToolCalls = this.streamingMessage.content.some(
        (b) => b.type === "toolCall",
      );

      // Finalize: move streaming message into stable messages
      const finalMessage = { ...this.streamingMessage };
      this.streamingMessage = null;

      this._state = {
        ...this._state,
        messages: [...this._state.messages, finalMessage],
        // Keep streaming/pending state alive if tools are about to execute
        isStreaming: hasToolCalls,
        streamMessage: null,
        pendingToolCalls: hasToolCalls ? this._state.pendingToolCalls : new Set(),
      };

      this.emit({ type: "message_end", message: finalMessage });

      if (!hasToolCalls) {
        // No tool calls — this is the final message in the turn
        this.emit({
          type: "turn_end",
          message: finalMessage,
          toolResults: this._state.messages.filter(
            (m): m is ToolResultMessage => (m as ToolResultMessage).role === "toolResult",
          ),
        });
        this.emit({ type: "agent_end", messages: [finalMessage] });
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function makeEmptyAssistant(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "remote",
    usage: { ...EMPTY_USAGE },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function socketToolToAgentTool(t: SocketTool): AgentTool {
  return {
    name: t.name,
    label: t.name,
    description: t.description,
    parameters: { type: "object", properties: {} } as never,
    execute: async () => ({ content: [], details: {} }),
  };
}

/**
 * Rebuild proper AgentMessage[] from pi-socket's flat history events.
 * Groups deltas + tool_start into assistant messages, user_messages into user messages.
 */
function rebuildMessages(events: HistoryEvent[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let currentAssistant: AssistantMessage | null = null;
  let toolCallCounter = 0;

  function flushAssistant() {
    if (currentAssistant) {
      messages.push(currentAssistant);
      currentAssistant = null;
    }
  }

  for (const ev of events) {
    switch (ev.type) {
      case "user_message":
        flushAssistant();
        messages.push({
          role: "user",
          content: ev.text,
          timestamp: Date.now(),
        } satisfies UserMessage);
        break;

      case "delta":
        if (!currentAssistant) {
          currentAssistant = makeEmptyAssistant();
        }
        {
          const content = currentAssistant.content;
          const last = content[content.length - 1];
          if (last && last.type === "text") {
            (last as TextContent).text += ev.text;
          } else {
            content.push({ type: "text", text: ev.text });
          }
        }
        break;

      case "thinking_delta":
        if (!currentAssistant) {
          currentAssistant = makeEmptyAssistant();
        }
        {
          const content = currentAssistant.content;
          const last = content[content.length - 1];
          if (last && last.type === "thinking") {
            (last as ThinkingContent).thinking += ev.text;
          } else {
            content.push({ type: "thinking", thinking: ev.text });
          }
        }
        break;

      case "tool_start":
        if (!currentAssistant) {
          currentAssistant = makeEmptyAssistant();
        }
        currentAssistant.content.push({
          type: "toolCall",
          id: `tc_hist_${++toolCallCounter}`,
          name: ev.name,
          arguments: (ev.args as Record<string, unknown>) ?? {},
        });
        break;

      case "tool_end": {
        // Find the matching tool call
        const tc = currentAssistant?.content
          .filter((b): b is ToolCall => b.type === "toolCall" && b.name === ev.name)
          .pop();
        if (tc) {
          // Flush the assistant message that contained this tool call
          flushAssistant();
          // Add tool result
          messages.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: ev.name,
            content: [{ type: "text", text: ev.result ?? (ev.isError ? "Error" : "Done") }],
            isError: ev.isError,
            timestamp: Date.now(),
          } satisfies ToolResultMessage);
        }
        break;
      }
    }
  }

  flushAssistant();
  return messages;
}
