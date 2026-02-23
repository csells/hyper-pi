import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { RemoteAgent } from "./RemoteAgent";
import type { NodeInfo, AgentStatus } from "./types";

interface UseAgentReturn {
  status: AgentStatus;
  remoteAgent: RemoteAgent;
  historyTruncated: boolean;
  sendMessage: (text: string) => void;
}

export function useAgent(activeNode: NodeInfo | null): UseAgentReturn {
  const [status, setStatus] = useState<AgentStatus>("disconnected");
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeNodeRef = useRef<NodeInfo | null>(activeNode);
  const remoteAgent = useMemo(() => new RemoteAgent(), []);

  useEffect(() => {
    activeNodeRef.current = activeNode;
  }, [activeNode]);

  const handleInitState = useCallback(
    (payload: { truncated?: boolean }) => {
      setHistoryTruncated(payload.truncated ?? false);
      // RemoteAgent handles init_state internally via handleSocketEvent
    },
    [],
  );

  useEffect(() => {
    if (!activeNode || activeNode.status !== "active") {
      if (activeNode?.status === "offline") {
        setStatus("offline");
      }
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus("connecting");
    remoteAgent.reset();
    setHistoryTruncated(false);

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false; // set by cleanup to stop reconnects
    const nodeId = activeNode.id; // capture for closures (activeNode is non-null here)

    function connect() {
      // Connect via hypivisor proxy — single port, no direct agent access needed
      const hypivisorHost = window.location.hostname;
      const hypivisorPort = import.meta.env.VITE_HYPIVISOR_PORT || "31415";
      const token = import.meta.env.VITE_HYPI_TOKEN || "";
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
      const ws = new WebSocket(
        `ws://${hypivisorHost}:${hypivisorPort}/ws/agent/${encodeURIComponent(nodeId)}${tokenParam}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        remoteAgent.connect(ws);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "init_state") {
          handleInitState(data as { truncated?: boolean });
        }
      };

      ws.onclose = () => {
        if (closed) return;
        // Don't clear messages on temporary disconnect — keep showing last state
        setStatus("connecting");
        reconnectTimer = setTimeout(() => {
          const current = activeNodeRef.current;
          if (current?.id === nodeId && current.status === "active") {
            connect();
          } else {
            setStatus("offline");
          }
        }, 3000);
      };

      ws.onerror = () => {};
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      remoteAgent.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeNode ref avoids reconnect loops
  }, [activeNode?.id, activeNode?.status, remoteAgent, handleInitState]);

  const sendMessage = useCallback(
    (text: string) => {
      remoteAgent.prompt(text);
    },
    [remoteAgent],
  );

  return { status, remoteAgent, historyTruncated, sendMessage };
}
