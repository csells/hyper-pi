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
    removeEventListener() {},
    // Simulate receiving a message from pi-socket
    receive(data: unknown) {
      for (const fn of listeners.get("message") ?? []) {
        fn({ data: JSON.stringify(data) });
      }
    },
  };
  return { ws: ws as unknown as WebSocket, sent, receive: ws.receive.bind(ws) };
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
});
