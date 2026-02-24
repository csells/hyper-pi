import { useState, useEffect, useRef, useCallback } from "react";
import { handleRpcResponse, rejectAllPending } from "./rpc";
import type { NodeInfo, HypivisorStatus, HypivisorEvent, RpcResponse } from "./types";

interface UseHypivisorReturn {
  status: HypivisorStatus;
  nodes: NodeInfo[];
  wsRef: React.RefObject<WebSocket | null>;
  setNodes: React.Dispatch<React.SetStateAction<NodeInfo[]>>;
}

/**
 * Build the base WebSocket URL for the hypivisor.
 * If VITE_HYPIVISOR_URL is set (e.g. "wss://my-tunnel.trycloudflare.com"),
 * use that directly. Otherwise fall back to ws://hostname:port.
 */
export function buildHypivisorWsUrl(port: number): string {
  const envUrl = import.meta.env.VITE_HYPIVISOR_URL;
  if (envUrl) return envUrl.replace(/\/$/, ""); // strip trailing slash
  return `ws://${window.location.hostname}:${port}`;
}

export function useHypivisor(port: number, token: string): UseHypivisorReturn {
  const [status, setStatus] = useState<HypivisorStatus>("connecting");
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const initReceivedRef = useRef<boolean>(false);

  const handleEvent = useCallback((data: HypivisorEvent) => {
    switch (data.event) {
      case "init":
        initReceivedRef.current = true;
        setNodes(data.nodes);
        break;

      case "node_joined":
        // Drop incremental events until init arrives
        if (!initReceivedRef.current) return;
        setNodes((prev) => {
          const filtered = prev.filter((n) => n.id !== data.node.id);
          return [...filtered, { ...data.node, status: "active" as const }];
        });
        break;

      case "node_offline":
        // Drop incremental events until init arrives
        if (!initReceivedRef.current) return;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === data.id ? { ...n, status: "offline" as const } : n,
          ),
        );
        break;

      case "node_removed":
        // Drop incremental events until init arrives
        if (!initReceivedRef.current) return;
        setNodes((prev) => prev.filter((n) => n.id !== data.id));
        break;
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      if (disposed) return;
      // Close previous connection before creating a new one
      if (ws) {
        ws.onclose = null; // prevent close → reconnect loop
        ws.onmessage = null; // prevent ghost messages from old WS
        ws.close();
      }
      // Reset initReceived flag for new connection
      initReceivedRef.current = false;
      const url = `${buildHypivisorWsUrl(port)}/ws${token ? `?token=${token}` : ""}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");

      ws.onmessage = (event) => {
        let data: HypivisorEvent | RpcResponse;
        try {
          data = JSON.parse(event.data) as HypivisorEvent | RpcResponse;
        } catch (e) {
          console.error("[useHypivisor] Failed to parse WebSocket message:", e);
          return;
        }

        // Push event (check first, before checking for RPC response)
        // because node_offline and node_removed also have an 'id' field
        if ("event" in data) {
          handleEvent(data as HypivisorEvent);
          return;
        }

        // RPC response (has id field but no event field)
        if ("id" in data && data.id) {
          handleRpcResponse(data as RpcResponse);
          return;
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        rejectAllPending("WebSocket disconnected");
        if (!disposed) {
          console.warn("[useHypivisor] Disconnected from hypivisor, reconnecting in 5s");
          reconnectTimer = setTimeout(connect, 5000);
        }
      };

      ws.onerror = () => {
        // Suppress console noise — onclose handles reconnect
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // prevent close → reconnect after disposal
        ws.onmessage = null; // prevent ghost messages after disposal
        ws.close();
      }
      wsRef.current = null;
    };
  }, [port, token, handleEvent]);

  return { status, nodes, wsRef, setNodes };
}
