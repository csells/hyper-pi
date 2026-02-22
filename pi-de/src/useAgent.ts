import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { RemoteAgent } from "./RemoteAgent";
import type { NodeInfo, AgentStatus, InitStateEvent } from "./types";

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
    (payload: InitStateEvent) => {
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

    const ws = new WebSocket(`ws://${activeNode.machine}:${activeNode.port}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      remoteAgent.connect(ws);
    };

    ws.onmessage = (event) => {
      // Check for init_state to track truncation at hook level
      const data = JSON.parse(event.data);
      if (data.type === "init_state") {
        handleInitState(data as InitStateEvent);
      }
      // RemoteAgent processes all events via its own listener registered in connect()
    };

    ws.onclose = () => {
      setStatus("disconnected");
      remoteAgent.disconnect();
      setTimeout(() => {
        const current = activeNodeRef.current;
        if (current?.id === activeNode.id && current.status === "active") {
          setStatus("connecting");
        } else {
          setStatus("offline");
        }
      }, 5000);
    };

    ws.onerror = () => {};

    return () => {
      ws.close();
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
