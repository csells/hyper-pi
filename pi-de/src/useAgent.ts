import { useState, useEffect, useRef, useCallback } from "react";
import { applyEvent, rebuildHistory } from "./events";
import type {
  NodeInfo,
  Tool,
  ChatMessage,
  AgentStatus,
  AgentEvent,
  InitStateEvent,
} from "./types";

interface UseAgentReturn {
  status: AgentStatus;
  messages: ChatMessage[];
  tools: Tool[];
  historyTruncated: boolean;
  wsRef: React.RefObject<WebSocket | null>;
  sendMessage: (text: string) => void;
  addOptimisticMessage: (text: string) => void;
}

export function useAgent(activeNode: NodeInfo | null): UseAgentReturn {
  const [status, setStatus] = useState<AgentStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeNodeRef = useRef<NodeInfo | null>(activeNode);

  // Keep ref in sync to avoid stale closures in reconnect timer
  useEffect(() => {
    activeNodeRef.current = activeNode;
  }, [activeNode]);

  const handleInitState = useCallback((payload: InitStateEvent) => {
    setTools(payload.tools);
    setHistoryTruncated(payload.truncated ?? false);
    setMessages(rebuildHistory(payload.events));
  }, []);

  const handleEvent = useCallback((payload: AgentEvent) => {
    if (payload.type === "init_state") {
      handleInitState(payload);
      return;
    }
    setMessages((prev) => applyEvent(prev, payload));
  }, [handleInitState]);

  useEffect(() => {
    if (!activeNode || activeNode.status !== "active") {
      if (activeNode?.status === "offline") {
        setStatus("offline");
      }
      return;
    }

    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus("connecting");
    setMessages([]);
    setTools([]);
    setHistoryTruncated(false);

    // Connect through the hypivisor proxy — single port, no direct agent exposure
    const hvPort = import.meta.env.VITE_HYPIVISOR_PORT || "31415";
    const hvToken = import.meta.env.VITE_HYPI_TOKEN || "";
    const tokenParam = hvToken ? `?token=${hvToken}` : "";
    const ws = new WebSocket(`ws://localhost:${hvPort}/ws/agent/${activeNode.id}${tokenParam}`);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data) as AgentEvent;
      handleEvent(payload);
    };

    ws.onclose = () => {
      setStatus("disconnected");
      // Use ref for latest node to avoid stale closure
      const retryTimer = setTimeout(() => {
        const current = activeNodeRef.current;
        if (current?.id === activeNode.id && current.status === "active") {
          // Will trigger this effect again via parent re-render
          setStatus("connecting");
        } else {
          setStatus("offline");
        }
      }, 5000);

      return () => clearTimeout(retryTimer);
    };

    ws.onerror = () => {
      // Suppress console noise — onclose handles reconnect
    };

    return () => {
      ws.close();
    };
  }, [activeNode?.id, activeNode?.status, handleEvent]);

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(text);
    }
  }, []);

  const addOptimisticMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: "user" as const, content: text }]);
  }, []);

  return { status, messages, tools, historyTruncated, wsRef, sendMessage, addOptimisticMessage };
}
