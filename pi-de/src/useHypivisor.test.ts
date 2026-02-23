import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useHypivisor } from "./useHypivisor";
import type { NodeInfo, HypivisorEvent } from "./types";

function makeNode(id: string, port: number, status: "active" | "offline" = "active"): NodeInfo {
  return { id, machine: "localhost", cwd: "/tmp/test", port, status };
}

describe("useHypivisor", () => {
  let webSocketInstances: any[] = [];

  beforeEach(() => {
    webSocketInstances = [];

    class MockWebSocket {
      url: string;
      send = vi.fn();
      close = vi.fn();
      onopen: ((this: WebSocket, ev: Event) => any) | null = null;
      onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
      onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
      onerror: ((this: WebSocket, ev: Event) => any) | null = null;
      readyState = 1;

      constructor(url: string) {
        this.url = url;
        webSocketInstances.push(this);
      }
    }

    (global as any).WebSocket = MockWebSocket;

    Object.defineProperty(window, "location", {
      value: { hostname: "localhost" },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    webSocketInstances = [];
  });

  it("drops incremental events before init arrives", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));
    const ws = webSocketInstances[0];

    // node_joined before init — should be dropped
    const event: HypivisorEvent = {
      event: "node_joined",
      node: makeNode("node-1", 9000),
    };
    ws.onmessage?.call(ws, { data: JSON.stringify(event) } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toEqual([]);
    });

    // node_offline before init — should be dropped
    ws.onmessage?.call(ws, {
      data: JSON.stringify({ event: "node_offline", id: "node-2" }),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toEqual([]);
    });

    // node_removed before init — should be dropped
    ws.onmessage?.call(ws, {
      data: JSON.stringify({ event: "node_removed", id: "node-3" }),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toEqual([]);
    });
  });

  it("init replaces full node list and enables incremental events", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));
    const ws = webSocketInstances[0];

    const initEvent: HypivisorEvent = {
      event: "init",
      nodes: [makeNode("node-1", 9000), makeNode("node-2", 9001)],
      protocol_version: "1",
    };
    ws.onmessage?.call(ws, { data: JSON.stringify(initEvent) } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(2);
      expect(result.current.nodes[0].id).toBe("node-1");
      expect(result.current.nodes[1].id).toBe("node-2");
    });

    // After init, incremental events should work
    const joinEvent: HypivisorEvent = {
      event: "node_joined",
      node: makeNode("node-3", 9002),
    };
    ws.onmessage?.call(ws, { data: JSON.stringify(joinEvent) } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(3);
      expect(result.current.nodes[2].id).toBe("node-3");
    });
  });

  it("reconnect nulls old WebSocket handlers", async () => {
    const { rerender } = renderHook(
      ({ port, token }) => useHypivisor(port, token),
      { initialProps: { port: 31415, token: "" } },
    );

    expect(webSocketInstances).toHaveLength(1);
    const firstWs = webSocketInstances[0];

    rerender({ port: 31416, token: "" });

    expect(firstWs.onclose).toBeNull();
    expect(firstWs.onmessage).toBeNull();
    expect(firstWs.close).toHaveBeenCalled();
    expect(webSocketInstances).toHaveLength(2);
  });

  it("uses window.location.hostname in WebSocket URL", async () => {
    Object.defineProperty(window, "location", {
      value: { hostname: "custom-host" },
      writable: true,
    });

    renderHook(() => useHypivisor(31415, ""));

    expect(webSocketInstances[0].url).toContain("custom-host");
    expect(webSocketInstances[0].url).not.toContain("localhost");
  });

  it("deduplicates nodes by id on node_joined", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));
    const ws = webSocketInstances[0];

    // Init with 1 node
    ws.onmessage?.call(ws, {
      data: JSON.stringify({
        event: "init",
        nodes: [makeNode("node-1", 9000)],
        protocol_version: "1",
      }),
    } as MessageEvent);

    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    // Re-join same id — should replace, not accumulate
    ws.onmessage?.call(ws, {
      data: JSON.stringify({
        event: "node_joined",
        node: makeNode("node-1", 9000),
      }),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
    });
  });

  it("handles node_offline correctly after init", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));
    const ws = webSocketInstances[0];

    ws.onmessage?.call(ws, {
      data: JSON.stringify({
        event: "init",
        nodes: [makeNode("node-1", 9000)],
        protocol_version: "1",
      }),
    } as MessageEvent);

    await waitFor(() => expect(result.current.nodes[0].status).toBe("active"));

    ws.onmessage?.call(ws, {
      data: JSON.stringify({ event: "node_offline", id: "node-1" }),
    } as MessageEvent);

    await waitFor(() => expect(result.current.nodes[0].status).toBe("offline"));
  });

  it("handles node_removed correctly after init", async () => {
    const { result } = renderHook(() => useHypivisor(31415, ""));
    const ws = webSocketInstances[0];

    ws.onmessage?.call(ws, {
      data: JSON.stringify({
        event: "init",
        nodes: [makeNode("node-1", 9000), makeNode("node-2", 9001)],
        protocol_version: "1",
      }),
    } as MessageEvent);

    await waitFor(() => expect(result.current.nodes).toHaveLength(2));

    ws.onmessage?.call(ws, {
      data: JSON.stringify({ event: "node_removed", id: "node-1" }),
    } as MessageEvent);

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.nodes[0].id).toBe("node-2");
    });
  });
});
