import { useState, useEffect, useRef } from "react";
import { useHypivisor } from "./useHypivisor";
import { useAgent } from "./useAgent";
import SpawnModal from "./SpawnModal";
import type { NodeInfo } from "./types";

// ── Lit class-field-shadowing fix ─────────────────────────────────────
// This side-effect import patches ReactiveElement.performUpdate to clean
// up class-field-shadowed properties before Lit's dev-mode check.
// MUST be the first import so it runs before pi-web-ui registers elements.
import "./patchLit";

// Import pi-web-ui components (registers <agent-interface> custom element)
import "@mariozechner/pi-web-ui/app.css";
import "@mariozechner/pi-web-ui";
import { initPiDeStorage } from "./initStorage";

// Initialize minimal AppStorage so AgentInterface.sendMessage() can proceed.
// Must run before any <agent-interface> element calls getAppStorage().
initPiDeStorage();

const HYPI_TOKEN = import.meta.env.VITE_HYPI_TOKEN || "";
const HYPIVISOR_PORT = parseInt(import.meta.env.VITE_HYPIVISOR_PORT || "31415", 10);

export default function App() {
  const { status: hvStatus, nodes, wsRef: hvWsRef } = useHypivisor(HYPIVISOR_PORT, HYPI_TOKEN);
  const [activeNode, setActiveNode] = useState<NodeInfo | null>(null);
  const agent = useAgent(activeNode);

  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const agentInterfaceRef = useRef<HTMLElement | null>(null);



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

  // Wire RemoteAgent into <agent-interface> whenever agent or ref changes
  useEffect(() => {
    const el = agentInterfaceRef.current;
    if (!el) return;
    // Set properties on the Lit web component via typed interface
    const ai = el as HTMLElement & {
      session: unknown;
      enableModelSelector: boolean;
      enableThinkingSelector: boolean;
      enableAttachments: boolean;
    };
    ai.session = agent.remoteAgent;
    ai.enableModelSelector = false;
    ai.enableThinkingSelector = false;
    ai.enableAttachments = false;
  }, [agent.remoteAgent, agent.status, activeNode]);

  const projectName = (cwd: string) =>
    cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;

  return (
    <div className="pi-de-layout">
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
                Showing recent history (truncated)
              </div>
            )}

            {/* pi-web-ui AgentInterface web component */}
            <div className="agent-interface-container dark">
              <agent-interface ref={agentInterfaceRef} />
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
