import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useHypivisor } from "./useHypivisor";
import type { NodeInfo, HypivisorEvent } from "./types";

describe("useHypivisor", () => {
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
      readyState = 1; // OPEN

      constructor(url: string) {
        webSocketInstances.push(this);
      }
    }

    (global as any).WebSocket = MockWebSocket;

    // Mock window.location.hostname
    Object.defineProperty(window, "location", {
      value: {
        hostname: "localhost",
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    webSocketInstances = [];
  });

  it("drops incremental events before init arrives", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));

    expect(result.current.nodes).toEqual([]);

    const ws = webSocketInstances[0];

    // Send node_joined before init
    const nodeJoinedEvent: HypivisorEvent = {
      event: "node_joined",
      node: {
        id: "node-1",
        machine: "localhost",
        port: 9000,
        status: "active",
      },
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeJoinedEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toEqual([]);
    });

    // Also test node_offline and node_removed before init
    const nodeOfflineEvent: HypivisorEvent = {
      event: "node_offline",
      id: "node-2",
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeOfflineEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toEqual([]);
    });

    const nodeRemovedEvent: HypivisorEvent = {
      event: "node_removed",
      id: "node-3",
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeRemovedEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toEqual([]);
    });
  });

  it("init replaces full node list", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));

    const ws = webSocketInstances[0];

    const initEvent: HypivisorEvent = {
      event: "init",
      nodes: [
        {
          id: "node-1",
          machine: "localhost",
          port: 9000,
          status: "active",
        },
        {
          id: "node-2",
          machine: "localhost",
          port: 9001,
          status: "active",
        },
      ],
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(initEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(2);
      expect(result.current.nodes[0].id).toBe("node-1");
      expect(result.current.nodes[1].id).toBe("node-2");
    });

    // After init, incremental events should be processed
    const nodeJoinedEvent: HypivisorEvent = {
      event: "node_joined",
      node: {
        id: "node-3",
        machine: "localhost",
        port: 9002,
        status: "active",
      },
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeJoinedEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(3);
      expect(result.current.nodes[2].id).toBe("node-3");
    });
  });

  it("reconnect nulls old WebSocket handlers", async () => {
    const { rerender } = renderHook(
      ({ port, token }) => useHypivisor(port, token),
      {
        initialProps: { port: 31415, token: "" },
      },
    );

    expect(webSocketInstances).toHaveLength(1);
    const firstWs = webSocketInstances[0];

    // Trigger reconnect by changing port
    rerender({ port: 31416, token: "" });

    // Verify first WebSocket handlers were nulled
    expect(firstWs.onclose).toBeNull();
    expect(firstWs.onmessage).toBeNull();
    expect(firstWs.close).toHaveBeenCalled();

    // Second WebSocket created
    expect(webSocketInstances).toHaveLength(2);
  });

  it("uses window.location.hostname instead of hardcoded localhost", async () => {
    let capturedUrl = "";
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class MockWebSocket extends originalWebSocket {
      constructor(url: string) {
        capturedUrl = url;
        super(url);
      }
    };

    Object.defineProperty(window, "location", {
      value: {
        hostname: "custom-host",
      },
      writable: true,
    });

    renderHook(() => useHypivisor(31415, ""));

    expect(capturedUrl).toContain("custom-host");
    expect(capturedUrl).not.toContain("localhost");
  });

  it("deduplicates nodes by id on node_joined", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));

    const ws = webSocketInstances[0];

    // Initialize with nodes
    const initEvent: HypivisorEvent = {
      event: "init",
      nodes: [
        {
          id: "node-1",
          machine: "localhost",
          port: 9000,
          status: "active",
        },
      ],
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(initEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
    });

    // Re-register same node with new session id (should replace, not accumulate)
    const nodeRejoinEvent: HypivisorEvent = {
      event: "node_joined",
      node: {
        id: "node-1",
        machine: "localhost",
        port: 9000,
        status: "active",
      },
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeRejoinEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.nodes[0].id).toBe("node-1");
    });
  });

  it("handles node_offline correctly after init", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));

    const ws = webSocketInstances[0];

    const initEvent: HypivisorEvent = {
      event: "init",
      nodes: [
        {
          id: "node-1",
          machine: "localhost",
          port: 9000,
          status: "active",
        },
      ],
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(initEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes[0].status).toBe("active");
    });

    const nodeOfflineEvent: HypivisorEvent = {
      event: "node_offline",
      id: "node-1",
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeOfflineEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes[0].status).toBe("offline");
    });
  });

  it("handles node_removed correctly after init", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));

    const ws = webSocketInstances[0];

    const initEvent: HypivisorEvent = {
      event: "init",
      nodes: [
        {
          id: "node-1",
          machine: "localhost",
          port: 9000,
          status: "active",
        },
        {
          id: "node-2",
          machine: "localhost",
          port: 9001,
          status: "active",
        },
      ],
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(initEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(2);
    });

    const nodeRemovedEvent: HypivisorEvent = {
      event: "node_removed",
      id: "node-1",
    };

    ws.onmessage?.call(ws, {
      data: JSON.stringify(nodeRemovedEvent),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.nodes[0].id).toBe("node-2");
    });
  });
});
