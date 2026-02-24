import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { RemoteAgent } from "./RemoteAgent";
import { buildHypivisorWsUrl } from "./useHypivisor";
import type { NodeInfo, AgentStatus } from "./types";

interface UseAgentReturn {
  status: AgentStatus;
  remoteAgent: RemoteAgent;
  historyTruncated: boolean;
  sendMessage: (text: string) => void;
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  loadOlderMessages: () => void;
}

export function useAgent(activeNode: NodeInfo | null): UseAgentReturn {
  const [status, setStatus] = useState<AgentStatus>("disconnected");
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const activeNodeRef = useRef<NodeInfo | null>(activeNode);
  const oldestIndexRef = useRef<number>(0);
  const remoteAgent = useMemo(() => new RemoteAgent(), []);

  useEffect(() => {
    activeNodeRef.current = activeNode;
  }, [activeNode]);

  const handleHistoryPage = useCallback(
    (page: { hasMore: boolean; oldestIndex: number }) => {
      oldestIndexRef.current = page.oldestIndex;
      setHasMoreHistory(page.hasMore);
      setIsLoadingHistory(false);
    },
    [],
  );

  const loadOlderMessages = useCallback(() => {
    if (isLoadingHistory || !hasMoreHistory) {
      return;
    }
    setIsLoadingHistory(true);
    remoteAgent.fetchHistory(oldestIndexRef.current, 50);
  }, [remoteAgent, isLoadingHistory, hasMoreHistory]);

  const handleInitState = useCallback(
    (payload: { truncated?: boolean; totalMessages?: number }) => {
      setHistoryTruncated(payload.truncated ?? false);
      // Initialize oldestIndex to current message count for pagination
      oldestIndexRef.current = payload.totalMessages ?? 0;
      setHasMoreHistory(payload.truncated ?? false);
      setIsLoadingHistory(false);
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

    setStatus("connecting");
    remoteAgent.reset();
    setHistoryTruncated(false);

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false; // set by cleanup to stop reconnects
    const nodeId = activeNode.id; // capture for closures (activeNode is non-null here)

    function connect() {
      // Close previous WebSocket if it exists (prevent connection leak)
      const prevWs = wsRef.current;
      if (prevWs) {
        // Null the onclose handler first to prevent recursive reconnect on this old connection
        prevWs.onclose = null;
        prevWs.close();
      }

      // Connect via hypivisor proxy — single port, no direct agent access needed
      const hypivisorPort = import.meta.env.VITE_HYPIVISOR_PORT || "31415";
      const token = import.meta.env.VITE_HYPI_TOKEN || "";
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
      const baseUrl = buildHypivisorWsUrl(parseInt(hypivisorPort, 10));
      const ws = new WebSocket(
        `${baseUrl}/ws/agent/${encodeURIComponent(nodeId)}${tokenParam}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        // Set up callbacks for RemoteAgent events before connecting
        remoteAgent.onInitState = handleInitState;
        remoteAgent.onHistoryPage = handleHistoryPage;
        remoteAgent.onError = () => {
          setStatus("offline");
          ws.close();
        };
        remoteAgent.connect(ws);
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

      ws.onerror = (e) => console.warn("[useAgent] WebSocket error:", e);
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      remoteAgent.disconnect();
      setIsLoadingHistory(false);
      setHasMoreHistory(true);
      oldestIndexRef.current = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeNode ref avoids reconnect loops
  }, [activeNode?.id, remoteAgent, handleInitState, handleHistoryPage]);

  const sendMessage = useCallback(
    (text: string) => {
      remoteAgent.prompt(text);
    },
    [remoteAgent],
  );

  return {
    status,
    remoteAgent,
    historyTruncated,
    sendMessage,
    isLoadingHistory,
    hasMoreHistory,
    loadOlderMessages,
  };
}
