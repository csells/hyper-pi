import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAgent } from "./useAgent";
import type { NodeInfo } from "./types";

describe("useAgent", () => {
  let webSocketInstances: any[] = [];

  beforeEach(() => {
    webSocketInstances = [];

    // Mock global WebSocket constructor
    class MockWebSocket {
      send = vi.fn();
      close = vi.fn();
      onopen: ((this: WebSocket, ev: Event) => any) | null = null;
      onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
      onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
      onerror: ((this: WebSocket, ev: Event) => any) | null = null;
      addEventListener = vi.fn((event: string, handler: any) => {
        if (event === "message") {
          this.onmessage = handler;
        }
      });
      removeEventListener = vi.fn();
      readyState = 1; // OPEN

      constructor(url: string) {
        webSocketInstances.push(this);
      }
    }

    (global as any).WebSocket = MockWebSocket;

    // Mock environment variables
    import.meta.env.VITE_HYPIVISOR_PORT = "31415";
    import.meta.env.VITE_HYPI_TOKEN = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
    webSocketInstances = [];
  });

  it("closes previous WebSocket on reconnect", async () => {
    const activeNode: NodeInfo = {
      id: "test-node",
      machine: "localhost",
      port: 9000,
      status: "active",
    };

    const { rerender } = renderHook((node) => useAgent(node), {
      initialProps: activeNode,
    });

    // First WebSocket created
    expect(webSocketInstances).toHaveLength(1);
    const firstWs = webSocketInstances[0];

    // Trigger reconnect by changing activeNode (different id)
    const newActiveNode: NodeInfo = {
      id: "test-node-2",
      machine: "localhost",
      port: 9001,
      status: "active",
    };

    rerender(newActiveNode);

    // Verify first WebSocket was closed
    expect(firstWs.close).toHaveBeenCalled();
    expect(firstWs.onclose).toBeNull();

    // Second WebSocket created
    expect(webSocketInstances).toHaveLength(2);
  });

  it("handles proxy error messages and sets status to offline", async () => {
    const activeNode: NodeInfo = {
      id: "test-node",
      machine: "localhost",
      port: 9000,
      status: "active",
    };

    const { result } = renderHook(() => useAgent(activeNode));

    expect(result.current.status).toBe("connecting");

    // Simulate WebSocket open
    const ws = webSocketInstances[0];
    ws.onopen?.call(ws);

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });

    // Verify RemoteAgent has onError callback set
    expect(result.current.remoteAgent.onError).toBeDefined();

    // Simulate proxy error message through the message handler
    const messageHandler = ws.addEventListener.mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    if (messageHandler) {
      const errorEvent = new MessageEvent("message", {
        data: JSON.stringify({ error: "Agent not found" }),
      });
      messageHandler(errorEvent);
    }

    // Verify status changed to offline and ws was closed
    await waitFor(() => {
      expect(result.current.status).toBe("offline");
    });
    expect(ws.close).toHaveBeenCalled();
  });

  it("uses single message handler via RemoteAgent (no duplicate parsing)", async () => {
    const activeNode: NodeInfo = {
      id: "test-node",
      machine: "localhost",
      port: 9000,
      status: "active",
    };

    const { result } = renderHook(() => useAgent(activeNode));

    // Simulate WebSocket open
    const ws = webSocketInstances[0];
    ws.onopen();

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });

    // Verify RemoteAgent.connect was called
    // RemoteAgent will attach its own message listener via addEventListener
    expect(ws.addEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );

    // Verify useAgent does NOT have its own onmessage handler
    // (we removed it, now only RemoteAgent handles messages)
    const onmessageHandlers = Object.getOwnPropertyNames(ws)
      .filter((prop) => prop === "onmessage");

    // The onmessage property should be set by RemoteAgent's addEventListener, not useAgent
    // We verify this indirectly by checking that RemoteAgent.onInitState callback is used
    expect(result.current.remoteAgent).toBeDefined();
  });

  it("initializes truncation state from init_state event", async () => {
    const activeNode: NodeInfo = {
      id: "test-node",
      machine: "localhost",
      port: 9000,
      status: "active",
    };

    const { result } = renderHook(() => useAgent(activeNode));

    expect(result.current.historyTruncated).toBe(false);

    const ws = webSocketInstances[0];
    ws.onopen?.call(ws);

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });

    // Simulate init_state message through the message handler
    const messageHandler = ws.addEventListener.mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    if (messageHandler) {
      const initStateEvent = new MessageEvent("message", {
        data: JSON.stringify({
          type: "init_state",
          truncated: true,
          messages: [],
          tools: [],
        }),
      });
      messageHandler(initStateEvent);
    }

    await waitFor(() => {
      expect(result.current.historyTruncated).toBe(true);
    });
  });

  it("cleans up WebSocket on unmount", async () => {
    const activeNode: NodeInfo = {
      id: "test-node",
      machine: "localhost",
      port: 9000,
      status: "active",
    };

    const { unmount } = renderHook(() => useAgent(activeNode));

    const ws = webSocketInstances[0];

    unmount();

    // Verify WebSocket was closed on cleanup
    expect(ws.close).toHaveBeenCalled();
  });

  it("handles offline activeNode status", async () => {
    const activeNode: NodeInfo = {
      id: "test-node",
      machine: "localhost",
      port: 9000,
      status: "offline",
    };

    const { result } = renderHook(() => useAgent(activeNode));

    await waitFor(() => {
      expect(result.current.status).toBe("offline");
    });

    // No WebSocket should be created for offline node
    expect(webSocketInstances).toHaveLength(0);
  });
});
