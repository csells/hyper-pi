import { useState, useEffect, useRef } from "react";
import { useHypivisor } from "./useHypivisor";
import { useAgent } from "./useAgent";
import SpawnModal from "./SpawnModal";
import type { NodeInfo } from "./types";

const HYPI_TOKEN = import.meta.env.VITE_HYPI_TOKEN || "";
const HYPIVISOR_PORT = parseInt(import.meta.env.VITE_HYPIVISOR_PORT || "31415", 10);

export default function App() {
  const { status: hvStatus, nodes, wsRef: hvWsRef, setNodes } = useHypivisor(HYPIVISOR_PORT, HYPI_TOKEN);
  const [activeNode, setActiveNode] = useState<NodeInfo | null>(null);
  const agent = useAgent(activeNode);

  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inputText, setInputText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Keep activeNode status in sync with roster
  useEffect(() => {
    if (!activeNode) return;
    const updated = nodes.find((n) => n.id === activeNode.id);
    if (!updated) {
      setActiveNode(null);
    } else if (updated.status !== activeNode.status) {
      setActiveNode(updated);
    }
  }, [nodes, activeNode]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.messages]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    agent.sendMessage(text);
    agent.addOptimisticMessage(text);
    setInputText("");
  };

  const projectName = (cwd: string) =>
    cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div
      className={`pi-de-layout ${activeNode ? "agent-selected" : ""} ${!activeNode ? "no-inspector" : ""}`}
    >
      {/* ── LEFT: Roster ─────────────────────────────────── */}
      <div className="sidebar roster-pane">
        <h2>Hyper-Pi Mesh</h2>

        {hvStatus !== "connected" && (
          <div className="hv-status-banner">
            ⚠️{" "}
            {hvStatus === "connecting"
              ? "Connecting to hypivisor…"
              : "Disconnected — reconnecting…"}
          </div>
        )}

        <div className="node-list">
          {nodes.length === 0 && (
            <p className="empty">No agents online.</p>
          )}
          {nodes.map((node) => (
            <button
              key={node.id}
              className={`node-card ${activeNode?.id === node.id ? "active" : ""} ${node.status === "offline" ? "offline" : ""}`}
              onClick={() =>
                node.status === "active" && setActiveNode(node)
              }
              disabled={node.status === "offline"}
            >
              <div className="node-card-header">
                <strong>{projectName(node.cwd)}</strong>
                <span className={`status-dot ${node.status}`} />
              </div>
              <span className="metadata">
                {node.machine}:{node.port}
              </span>
              <span className="metadata cwd">{node.cwd}</span>
            </button>
          ))}
        </div>

        <button
          className="btn-spawn"
          onClick={() => setShowSpawnModal(true)}
          disabled={hvStatus !== "connected"}
        >
          + Spawn Agent
        </button>
      </div>

      {/* ── CENTER: Chat Stage ───────────────────────────── */}
      <div className="main-stage">
        {activeNode ? (
          <>
            <div className="stage-header">
              <h3>{activeNode.cwd}</h3>
              {isMobile && (
                <button
                  className="btn-inspector-toggle"
                  onClick={() => setShowInspector(!showInspector)}
                >
                  🔧
                </button>
              )}
              {agent.status !== "connected" && (
                <span className="agent-status">
                  {agent.status === "connecting" && "Connecting…"}
                  {agent.status === "disconnected" &&
                    "Connection lost — reconnecting…"}
                  {agent.status === "offline" && "Agent offline"}
                </span>
              )}
            </div>

            {agent.historyTruncated && (
              <div className="truncation-notice">
                Showing recent history. Older messages omitted due to
                conversation length.
              </div>
            )}

            <div className="chat-area">
              {agent.messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-${msg.role}`}>
                  {msg.role === "user" && (
                    <span className="msg-label">You</span>
                  )}
                  {msg.role === "assistant" && (
                    <span className="msg-label">Agent</span>
                  )}
                  <div className="msg-content">{msg.content}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="input-bar">
              <input
                type="text"
                placeholder="Send a message to this agent…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={agent.status !== "connected"}
              />
              <button
                onClick={handleSend}
                disabled={agent.status !== "connected"}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="empty-stage">
            <h1>Select an agent to begin.</h1>
            <p>
              Choose a running pi agent from the sidebar, or spawn a new
              one.
            </p>
          </div>
        )}
      </div>

      {/* ── RIGHT: Inspector ─────────────────────────────── */}
      {activeNode && (
        <div
          className={`sidebar inspector-pane ${isMobile ? "inspector-drawer" : ""} ${showInspector ? "open" : ""}`}
        >
          <h2>Loaded Tools</h2>
          <div className="tool-list">
            {agent.tools.length === 0 && (
              <p className="empty">No tools loaded.</p>
            )}
            {agent.tools.map((tool) => (
              <div key={tool.name} className="tool-card">
                <strong>{tool.name}</strong>
                <p>{tool.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Spawn Modal ──────────────────────────────────── */}
      {showSpawnModal && hvWsRef.current && (
        <SpawnModal
          hvWs={hvWsRef.current}
          onClose={() => setShowSpawnModal(false)}
        />
      )}
    </div>
  );
}
