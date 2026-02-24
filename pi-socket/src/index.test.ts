import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Create mock instances that will be reused
let mockWssInstance: any;
let mockHypivisorWsInstance: any;

// Mock modules BEFORE importing the module under test
vi.mock("./log.js");

vi.mock("portfinder", () => ({
  default: {
    getPortPromise: vi.fn(() => Promise.resolve(8080)),
  },
}));

vi.mock("ws", () => {
  const WebSocketMock: any = vi.fn(function(url: string) {
    return mockHypivisorWsInstance;
  });
  
  // Add constants to the mock
  WebSocketMock.OPEN = 1;
  WebSocketMock.CONNECTING = 0;
  WebSocketMock.CLOSING = 2;
  WebSocketMock.CLOSED = 3;
  
  return {
    WebSocketServer: vi.fn(function(options: any) {
      return mockWssInstance;
    }),
    WebSocket: WebSocketMock,
  };
});

import piSocket from "./index.js";
import * as log from "./log.js";
import { WebSocketServer, WebSocket } from "ws";

describe("pi-socket/index.ts", () => {
  let mockPi: Partial<ExtensionAPI>;
  let mockCtx: any;
  let piEventHandlers: Record<string, any[]> = {};

  beforeEach(() => {
    // Only clear the mock call history, not the implementations
    vi.mocked(WebSocketServer).mockClear();
    vi.mocked(WebSocket).mockClear();
    piEventHandlers = {};

    // Create fresh instances for each test
    mockWssInstance = {
      close: vi.fn(),
      clients: new Set(),
      on: vi.fn(),
    };

    mockHypivisorWsInstance = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
    };

    // Setup mockWss.on to capture handlers
    mockWssInstance.on.mockImplementation((event: string, handler: any) => {
      if (event === "connection") {
        mockWssInstance.connectionHandler = handler;
      }
      if (event === "error") {
        mockWssInstance.errorHandler = handler;
      }
    });

    // Setup mockHypivisorWs.on to capture handlers
    mockHypivisorWsInstance.on.mockImplementation((event: string, handler: any) => {
      mockHypivisorWsInstance[`${event}Handler`] = handler;
    });

    // Mock extension API
    mockPi = {
      on: vi.fn((event: string, handler: any) => {
        if (!piEventHandlers[event]) {
          piEventHandlers[event] = [];
        }
        piEventHandlers[event].push(handler);
      }),
      sendUserMessage: vi.fn(),
      getAllTools: vi.fn(() => [
        { name: "bash", description: "Run bash", parameters: {} as any },
      ]),
    };

    // Mock context
    mockCtx = {
      sessionManager: {
        getSessionId: vi.fn(() => "session-123"),
        getBranch: vi.fn(() => []),
      },
      isIdle: vi.fn(() => true),
      ui: {
        notify: vi.fn(),
      },
    };
  });

  describe("broadcast()", () => {
    it("handles no wss case gracefully", async () => {
      piSocket(mockPi as ExtensionAPI);

      const messageStartHandlers = piEventHandlers["message_start"];
      const testPayload = { type: "message_start" };

      expect(() => {
        messageStartHandlers[0](testPayload);
      }).not.toThrow();
    });
  });

  describe("session_start handler", () => {
    it("creates WebSocket server on new session", async () => {
      const { WebSocketServer } = await import("ws");
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      expect(WebSocketServer).toHaveBeenCalledWith({ port: 8080 });
    });

    it("sets nodeId from sessionManager.getSessionId()", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      expect(mockCtx.sessionManager.getSessionId).toHaveBeenCalled();
      
      // Trigger the open handler which calls send()
      mockHypivisorWsInstance.openHandler();
      
      expect(mockHypivisorWsInstance.send).toHaveBeenCalled();
      const registrationCall = mockHypivisorWsInstance.send.mock.calls[0][0];
      const registration = JSON.parse(registrationCall);
      expect(registration.params.id).toBe("session-123");
    });
  });

  describe("ws.on('message') handler", () => {
    it("sends message normally when idle", async () => {
      mockCtx.isIdle.mockReturnValue(true);
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
      mockWssInstance.connectionHandler(mockClient);

      const messageHandler = mockClient.on.mock.calls[0][1];
      messageHandler(Buffer.from("test message"));

      expect(mockPi.sendUserMessage).toHaveBeenCalledWith("test message");
    });

    it("sends as followUp when not idle", async () => {
      mockCtx.isIdle.mockReturnValue(false);
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = {
        readyState: 1, // OPEN
        send: vi.fn(),
        on: vi.fn(),
      };
      mockWssInstance.connectionHandler(mockClient);

      const messageHandler = mockClient.on.mock.calls[0][1];
      messageHandler(Buffer.from("follow up message"));

      expect(mockPi.sendUserMessage).toHaveBeenCalledWith("follow up message", {
        deliverAs: "followUp",
      });
    });

    it("rejects empty messages", async () => {
      mockCtx.isIdle.mockReturnValue(true);
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
      mockWssInstance.connectionHandler(mockClient);

      const messageHandler = mockClient.on.mock.calls[0][1];
      messageHandler(Buffer.from(""));

      expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith("pi-socket", "ignoring empty WebSocket message");
    });

    it("rejects whitespace-only messages", async () => {
      mockCtx.isIdle.mockReturnValue(true);
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
      mockWssInstance.connectionHandler(mockClient);

      const messageHandler = mockClient.on.mock.calls[0][1];
      messageHandler(Buffer.from("   \n\t  "));

      expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith("pi-socket", "ignoring empty WebSocket message");
    });

    it("logs and suppresses errors from sendUserMessage", async () => {
      const error = new Error("messages: at least one message is required");
      (mockPi.sendUserMessage as ReturnType<typeof vi.fn>).mockImplementation(() => { throw error; });
      mockCtx.isIdle.mockReturnValue(true);
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
      mockWssInstance.connectionHandler(mockClient);

      const messageHandler = mockClient.on.mock.calls[0][1];

      // Must not throw — error is caught and logged, never reaches pi output
      expect(() => messageHandler(Buffer.from("valid text"))).not.toThrow();
      expect(log.error).toHaveBeenCalledWith("sendUserMessage", error);
    });
  });

  describe("init_state on client connect", () => {
    it("sends init_state to new client", async () => {
      mockCtx.sessionManager.getBranch.mockReturnValue([]);
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = {
        readyState: 1, // OPEN
        send: vi.fn(),
        on: vi.fn(),
      };

      mockWssInstance.connectionHandler(mockClient);

      expect(mockClient.send).toHaveBeenCalled();
      const sentData = mockClient.send.mock.calls[0][0];
      const parsed = JSON.parse(sentData);
      expect(parsed.type).toBe("init_state");
      expect(parsed.messages).toEqual([]);
    });

    it("skips send if ws.readyState is not OPEN", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = {
        readyState: 0, // CONNECTING
        send: vi.fn(),
        on: vi.fn(),
      };

      mockWssInstance.connectionHandler(mockClient);

      expect(mockClient.send).not.toHaveBeenCalled();
    });
  });

  describe("Event forwarding", () => {
    it("has all event handlers registered", async () => {
      piSocket(mockPi as ExtensionAPI);

      const events = ["message_start", "message_update", "message_end"];
      for (const event of events) {
        expect(piEventHandlers[event]).toBeDefined();
        expect(piEventHandlers[event].length).toBeGreaterThan(0);
      }

      const toolEvents = [
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
      ];
      for (const event of toolEvents) {
        expect(piEventHandlers[event]).toBeDefined();
        expect(piEventHandlers[event].length).toBeGreaterThan(0);
      }
    });

    it("calls event handlers without throwing", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const messageStartHandlers = piEventHandlers["message_start"];
      expect(() => messageStartHandlers[0]({ type: "message_start" })).not.toThrow();

      const messageUpdateHandlers = piEventHandlers["message_update"];
      expect(() => messageUpdateHandlers[0]({ type: "message_update" })).not.toThrow();

      const toolStartHandlers = piEventHandlers["tool_execution_start"];
      expect(() => toolStartHandlers[0]({ type: "tool_execution_start" })).not.toThrow();
    });
  });

  describe("session_shutdown handler", () => {
    it("closes WSS during shutdown", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      mockWssInstance.close.mockClear();

      const sessionShutdownHandlers = piEventHandlers["session_shutdown"];
      await sessionShutdownHandlers[0]();

      expect(mockWssInstance.close).toHaveBeenCalled();
    });

    it("closes hypivisor WebSocket during shutdown", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      mockHypivisorWsInstance.close.mockClear();

      const sessionShutdownHandlers = piEventHandlers["session_shutdown"];
      await sessionShutdownHandlers[0]();

      expect(mockHypivisorWsInstance.close).toHaveBeenCalled();
    });

    it("requests shutdown", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const sessionShutdownHandlers = piEventHandlers["session_shutdown"];
      
      // Should not throw
      expect(() => sessionShutdownHandlers[0]()).not.toThrow();
    });
  });

  describe("Hypivisor connection", () => {
    it("connects to valid URL", async () => {
      const { WebSocket } = await import("ws");
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining("ws://"),
      );
    });

    it("registers hypivisor handlers", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      // Check that on() was called to register handlers
      expect(mockHypivisorWsInstance.on).toHaveBeenCalled();

      // Should have registered open, close, and error handlers
      const onCalls = mockHypivisorWsInstance.on.mock.calls.map((call: any[]) => call[0]);
      expect(onCalls).toContain("open");
      expect(onCalls).toContain("close");
      expect(onCalls).toContain("error");
    });
  });

  describe("Event handler registration", () => {
    it("registers all required event handlers", async () => {
      piSocket(mockPi as ExtensionAPI);

      const expectedEvents = [
        "session_start",
        "message_start",
        "message_update",
        "message_end",
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
        "session_shutdown",
      ];

      for (const event of expectedEvents) {
        expect(piEventHandlers[event]).toBeDefined();
        expect(piEventHandlers[event].length).toBeGreaterThan(0);
      }
    });
  });

  describe("Connection handler", () => {
    it("registers handlers on new client connection", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      const mockClient = {
        readyState: 1,
        send: vi.fn(),
        on: vi.fn(),
      };

      mockWssInstance.connectionHandler(mockClient);

      // Should have registered message and close handlers on the client
      expect(mockClient.on).toHaveBeenCalled();
      const onCalls = mockClient.on.mock.calls.map((call: any[]) => call[0]);
      expect(onCalls).toContain("message");
      expect(onCalls).toContain("close");
    });
  });

  describe("WebSocket server setup", () => {
    it("sets up error handling on WSS", async () => {
      piSocket(mockPi as ExtensionAPI);

      const sessionStartHandlers = piEventHandlers["session_start"];
      await sessionStartHandlers[0]({}, mockCtx);

      // Should have registered connection and error handlers
      expect(mockWssInstance.on).toHaveBeenCalled();
      const onCalls = mockWssInstance.on.mock.calls.map((call: any[]) => call[0]);
      expect(onCalls).toContain("connection");
      expect(onCalls).toContain("error");
    });
  });
});
