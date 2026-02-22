import { useState, useEffect, useRef, useCallback } from "react";
import { handleRpcResponse } from "./rpc";
import type { NodeInfo, HypivisorStatus, HypivisorEvent, RpcResponse } from "./types";

interface UseHypivisorReturn {
  status: HypivisorStatus;
  nodes: NodeInfo[];
  wsRef: React.RefObject<WebSocket | null>;
  setNodes: React.Dispatch<React.SetStateAction<NodeInfo[]>>;
}

export function useHypivisor(port: number, token: string): UseHypivisorReturn {
  const [status, setStatus] = useState<HypivisorStatus>("connecting");
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const handleEvent = useCallback((data: HypivisorEvent) => {
    switch (data.event) {
      case "init":
        setNodes(data.nodes);
        break;

      case "node_joined":
        setNodes((prev) => {
          const filtered = prev.filter((n) => n.id !== data.node.id);
          return [...filtered, { ...data.node, status: "active" as const }];
        });
        break;

      case "node_offline":
        setNodes((prev) =>
          prev.map((n) =>
            n.id === data.id ? { ...n, status: "offline" as const } : n,
          ),
        );
        break;

      case "node_removed":
        setNodes((prev) => prev.filter((n) => n.id !== data.id));
        break;
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const url = `ws://localhost:${port}/ws${token ? `?token=${token}` : ""}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as HypivisorEvent | RpcResponse;

        // RPC response (has id field)
        if ("id" in data && data.id) {
          handleRpcResponse(data as RpcResponse);
          return;
        }

        // Push event
        if ("event" in data) {
          handleEvent(data as HypivisorEvent);
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.error("[Pi-DE] Hypivisor WebSocket error:", err);
        setStatus("error");
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [port, token, handleEvent]);

  return { status, nodes, wsRef, setNodes };
}
