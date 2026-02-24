import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoteAgent } from "./RemoteAgent";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

/** Simulate a WebSocket that collects sent data and dispatches messages */
function createMockWebSocket() {
  const sent: string[] = [];
  const listeners = new Map<string, ((event: { data: string }) => void)[]>();
  const ws = {
    readyState: 1, // WebSocket.OPEN
    send(data: string) { sent.push(data); },
    addEventListener(type: string, fn: (event: { data: string }) => void) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener(type: string, fn: (event: { data: string }) => void) {
      const typeListeners = listeners.get(type);
      if (typeListeners) {
        const index = typeListeners.indexOf(fn);
        if (index > -1) {
          typeListeners.splice(index, 1);
        }
      }
    },
    // Simulate receiving a message from pi-socket
    receive(data: unknown) {
      for (const fn of listeners.get("message") ?? []) {
        fn({ data: JSON.stringify(data) });
      }
    },
  };
  return { ws: ws as unknown as WebSocket, sent, receive: ws.receive.bind(ws), listeners };
}

describe("RemoteAgent", () => {
  let agent: RemoteAgent;
  let events: AgentEvent[];

  beforeEach(() => {
    agent = new RemoteAgent();
    events = [];
    agent.subscribe((e) => events.push(e));
  });

  describe("init_state", () => {
    it("handles new format with messages array", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      const userMsg = { role: "user", content: "hello", timestamp: 1000 };
      const assistantMsg = {
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "remote",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop",
        timestamp: 2000,
      };

      receive({
        type: "init_state",
        messages: [userMsg, assistantMsg],
        tools: [{ name: "bash", description: "Run commands" }],
      });

      expect(agent.state.messages).toHaveLength(2);
      expect(agent.state.messages[0]).toEqual(userMsg);
      expect(agent.state.messages[1]).toEqual(assistantMsg);
      expect(agent.state.tools).toHaveLength(1);
      expect(agent.state.tools[0].name).toBe("bash");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("agent_end");
    });

    it("handles empty conversation", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      receive({ type: "init_state", messages: [], tools: [] });

      expect(agent.state.messages).toEqual([]);
      expect(agent.state.tools).toEqual([]);
    });
  });

  describe("event forwarding", () => {
    it("forwards message_start and updates state.messages", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({ type: "init_state", messages: [], tools: [] });
      events.length = 0;

      const userMsg = { role: "user", content: "test", timestamp: 1000 };
      receive({ type: "message_start", message: userMsg });

      expect(agent.state.messages).toHaveLength(1);
      expect(agent.state.messages[0]).toEqual(userMsg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message_start");
    });

    it("sets isStreaming for assistant message_start", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({ type: "init_state", messages: [], tools: [] });

      const assistantMsg = {
        role: "assistant", content: [], api: "anthropic-messages",
        provider: "anthropic", model: "remote",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop", timestamp: 2000,
      };
      receive({ type: "message_start", message: assistantMsg });

      expect(agent.state.isStreaming).toBe(true);
      expect(agent.state.streamMessage).toEqual(assistantMsg);
    });

    it("forwards message_update with streaming state", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({ type: "init_state", messages: [], tools: [] });

      const msg = {
        role: "assistant", content: [{ type: "text", text: "he" }],
        api: "anthropic-messages", provider: "anthropic", model: "remote",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop", timestamp: 2000,
      };
      receive({ type: "message_start", message: msg });
      events.length = 0;

      const updated = { ...msg, content: [{ type: "text", text: "hello" }] };
      receive({
        type: "message_update",
        message: updated,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "llo",
          partial: updated,
        },
      });

      expect(agent.state.streamMessage).toEqual(updated);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message_update");
    });

    it("forwards message_end and finalizes message", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({ type: "init_state", messages: [], tools: [] });

      const msg = {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "anthropic-messages", provider: "anthropic", model: "remote",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop", timestamp: 2000,
      };
      receive({ type: "message_start", message: msg });
      receive({ type: "message_end", message: msg });

      expect(agent.state.isStreaming).toBe(false);
      expect(agent.state.streamMessage).toBeNull();
      expect(agent.state.messages).toHaveLength(1);
      expect(agent.state.messages[0]).toEqual(msg);
    });

    it("tracks pendingToolCalls on tool_execution_start/end", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({ type: "init_state", messages: [], tools: [] });

      receive({
        type: "tool_execution_start",
        toolCallId: "tc_1",
        toolName: "bash",
        args: { command: "ls" },
      });

      expect(agent.state.pendingToolCalls.has("tc_1")).toBe(true);
      expect(agent.state.isStreaming).toBe(true);

      receive({
        type: "tool_execution_end",
        toolCallId: "tc_1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "file.ts" }] },
        isError: false,
      });

      expect(agent.state.pendingToolCalls.has("tc_1")).toBe(false);
      expect(agent.state.isStreaming).toBe(false);
    });
  });

  describe("prompt", () => {
    it("sends text over WebSocket", async () => {
      const { ws, sent, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({ type: "init_state", messages: [], tools: [] });

      await agent.prompt("hello");

      expect(sent).toEqual(["hello"]);
    });

    it("does nothing if WebSocket not connected", async () => {
      await agent.prompt("hello");
      // Should not throw
    });
  });

  describe("subscribe", () => {
    it("emits agent_end on subscribe if messages exist", async () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);
      receive({
        type: "init_state",
        messages: [{ role: "user", content: "hi", timestamp: 1000 }],
        tools: [],
      });

      // New subscriber after init
      const lateEvents: AgentEvent[] = [];
      agent.subscribe((e) => lateEvents.push(e));

      // Wait for microtask
      await new Promise((r) => setTimeout(r, 0));

      expect(lateEvents.length).toBeGreaterThanOrEqual(1);
      expect(lateEvents[0].type).toBe("agent_end");
    });
  });

  describe("event listener cleanup", () => {
    it("disconnect removes event listener (old WS messages don't fire)", () => {
      const { ws, receive, listeners } = createMockWebSocket();
      agent.connect(ws);

      expect(listeners.get("message")!.length).toBe(1);

      agent.disconnect();

      expect(listeners.get("message")!.length).toBe(0);

      // Send a message to the old WS — listener should not fire
      events.length = 0;
      receive({ type: "init_state", messages: [], tools: [] });

      // No events should be emitted because the listener was removed
      expect(events).toHaveLength(0);
    });

    it("connect→disconnect→connect cycle doesn't leak listeners", () => {
      const { ws, listeners } = createMockWebSocket();

      // First connect
      agent.connect(ws);
      expect(listeners.get("message")!.length).toBe(1);

      // Disconnect
      agent.disconnect();
      expect(listeners.get("message")!.length).toBe(0);

      // Second connect (same WS)
      agent.connect(ws);
      expect(listeners.get("message")!.length).toBe(1);

      // Disconnect
      agent.disconnect();
      expect(listeners.get("message")!.length).toBe(0);

      // Third connect
      agent.connect(ws);
      expect(listeners.get("message")!.length).toBe(1);
    });

    it("connect calls disconnect first to clean up existing listener", () => {
      const { ws, listeners } = createMockWebSocket();

      agent.connect(ws);
      expect(listeners.get("message")!.length).toBe(1);

      // Calling connect again should clean up the old listener first
      agent.connect(ws);
      expect(listeners.get("message")!.length).toBe(1);
    });
  });

  describe("onInitState callback", () => {
    it("onInitState callback fires on init_state", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      const initStateEvents: any[] = [];
      agent.onInitState = (event) => initStateEvents.push(event);

      const userMsg = { role: "user", content: "hello", timestamp: 1000 };
      receive({
        type: "init_state",
        messages: [userMsg],
        tools: [{ name: "bash", description: "Run commands" }],
      });

      expect(initStateEvents).toHaveLength(1);
      expect(initStateEvents[0].type).toBe("init_state");
      expect(initStateEvents[0].messages).toEqual([userMsg]);
      expect(initStateEvents[0].tools).toHaveLength(1);
    });

    it("onInitState callback not called if not set", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      // Don't set agent.onInitState

      receive({
        type: "init_state",
        messages: [],
        tools: [],
      });

      // Should not throw and agent_end should still be emitted
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("agent_end");
    });

    it("initializes pagination state from init_state", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      const msgs = [
        { role: "user", content: "msg1", timestamp: 1000 },
        { role: "assistant", content: "msg2", timestamp: 2000 },
      ];
      receive({
        type: "init_state",
        messages: msgs,
        tools: [],
        truncated: true,
      });

      // oldestIndex should be initialized to the message count
      expect(agent.oldestIndex).toBe(2);
      expect(agent.hasMore).toBe(true);
    });

    it("sets hasMore to false when truncated is false", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      receive({
        type: "init_state",
        messages: [],
        tools: [],
        truncated: false,
      });

      expect(agent.hasMore).toBe(false);
    });
  });

  describe("fetchHistory", () => {
    it("sends fetch_history JSON request over WebSocket", () => {
      const { ws, sent } = createMockWebSocket();
      agent.connect(ws);

      agent.fetchHistory(100, 50);

      expect(sent).toHaveLength(1);
      const request = JSON.parse(sent[0]);
      expect(request).toEqual({ type: "fetch_history", before: 100, limit: 50 });
    });

    it("does nothing if WebSocket is not connected", () => {
      const { sent } = createMockWebSocket();
      // Don't connect the agent

      agent.fetchHistory(100, 50);

      expect(sent).toHaveLength(0);
    });

    it("does nothing if WebSocket is not in OPEN state", () => {
      const { ws, sent } = createMockWebSocket();
      agent.connect(ws);

      // Simulate closed connection
      (ws as any).readyState = 3; // WebSocket.CLOSED

      agent.fetchHistory(100, 50);

      expect(sent).toHaveLength(0);
    });
  });

  describe("history_page", () => {
    it("handles history_page response and prepends messages", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      // Start with some messages
      receive({
        type: "init_state",
        messages: [
          { role: "user", content: "msg 3", timestamp: 3000 },
          { role: "assistant", content: "msg 4", timestamp: 4000 },
        ],
        tools: [],
      });

      events = []; // Clear init_state event

      // Receive older messages
      receive({
        type: "history_page",
        messages: [
          { role: "user", content: "msg 1", timestamp: 1000 },
          { role: "assistant", content: "msg 2", timestamp: 2000 },
        ],
        hasMore: true,
        oldestIndex: 0,
      });

      // Messages should be prepended
      expect(agent.state.messages).toHaveLength(4);
      expect(agent.state.messages[0].content).toBe("msg 1");
      expect(agent.state.messages[3].content).toBe("msg 4");

      // Pagination state should be updated
      expect(agent.oldestIndex).toBe(0);
      expect(agent.hasMore).toBe(true);

      // agent_end event should be emitted
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("agent_end");
    });

    it("calls onHistoryPage callback if set", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      const historyPages: any[] = [];
      agent.onHistoryPage = (page) => historyPages.push(page);

      receive({
        type: "init_state",
        messages: [],
        tools: [],
      });

      receive({
        type: "history_page",
        messages: [{ role: "user", content: "old msg", timestamp: 1000 }],
        hasMore: false,
        oldestIndex: 0,
      });

      expect(historyPages).toHaveLength(1);
      expect(historyPages[0]).toEqual({
        type: "history_page",
        messages: [{ role: "user", content: "old msg", timestamp: 1000 }],
        hasMore: false,
        oldestIndex: 0,
      });
    });

    it("does not call onHistoryPage callback if not set", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      // Don't set agent.onHistoryPage

      receive({
        type: "init_state",
        messages: [],
        tools: [],
      });

      events = [];
      receive({
        type: "history_page",
        messages: [],
        hasMore: false,
        oldestIndex: 0,
      });

      // Should not throw and agent_end should be emitted
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("agent_end");
    });
  });

  describe("disconnect", () => {
    it("resets pagination state on disconnect", () => {
      const { ws, receive } = createMockWebSocket();
      agent.connect(ws);

      receive({
        type: "init_state",
        messages: [],
        tools: [],
        truncated: true,
      });

      expect(agent.hasMore).toBe(true);
      expect(agent.oldestIndex).toBe(0);

      agent.disconnect();

      expect(agent.hasMore).toBe(true); // Reset to default
      expect(agent.oldestIndex).toBe(0); // Reset to default
    });
  });
});
