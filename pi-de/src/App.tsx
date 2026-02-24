import { useState, useEffect, useRef } from "react";
import { useHypivisor } from "./useHypivisor";
import { useAgent } from "./useAgent";
import { useTheme } from "./useTheme";
import SpawnModal from "./SpawnModal";
import { patchMobileKeyboard } from "./patchMobileKeyboard";
import type { NodeInfo } from "./types";

// Import pi-web-ui components (registers <agent-interface> custom element)
import "@mariozechner/pi-web-ui/app.css";
import "@mariozechner/pi-web-ui";

// ── Lit class-field-shadowing fix ─────────────────────────────────────
// Patches ReactiveElement.performUpdate to clean up class-field-shadowed
// properties. MUST be imported AFTER pi-web-ui (needs registered elements)
// but takes effect before any element's first performUpdate (microtask).
import "./patchLit";

// Register mini-lit custom elements used by pi-web-ui message rendering.
// pi-web-ui's Messages.ts uses <markdown-block> and <code-block> but
// doesn't import them — the consuming app must ensure they're registered.
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import "@mariozechner/mini-lit/dist/CodeBlock.js";
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
  const { theme, resolvedTheme, cycleTheme } = useTheme();
  const {
    isLoadingHistory,
    hasMoreHistory,
    loadOlderMessages,
  } = agent;

  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const agentInterfaceRef = useRef<HTMLElement | null>(null);
  const scrollHeightRef = useRef<number>(0);



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

    // Patch mobile keyboard behavior: Enter = newline, Shift+Enter = send
    const cleanup = patchMobileKeyboard(el);
    return () => {
      cleanup();
    };

    // No overrides needed. The original AgentInterface.sendMessage:
    // 1. Checks isStreaming — allows sends when agent is idle
    // 2. Checks API key — dummy keys pre-populated in initPiDeStorage
    // 3. Clears the editor
    // 4. Calls this.session.prompt(text) → RemoteAgent.prompt → ws.send
  }, [agent.remoteAgent, agent.status, activeNode]);

  // Set up scroll listener for infinite scroll history loading
  useEffect(() => {
    const containerEl = agentInterfaceRef.current;
    if (!containerEl || !activeNode) return;

    // Find the scrollable container inside agent-interface
    const scrollableEl = containerEl.querySelector(".overflow-y-auto") as HTMLElement | null;
    if (!scrollableEl) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      // Debounce scroll events to avoid rapid duplicate requests
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (scrollableEl.scrollTop < 50 && hasMoreHistory && !isLoadingHistory) {
          // Save current scroll height before loading (for restoration)
          scrollHeightRef.current = scrollableEl.scrollHeight;
          loadOlderMessages();
        }
      }, 200);
    };

    scrollableEl.addEventListener("scroll", handleScroll);
    return () => {
      scrollableEl.removeEventListener("scroll", handleScroll);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [activeNode, hasMoreHistory, isLoadingHistory, loadOlderMessages]);

  // Restore scroll position after messages are prepended
  useEffect(() => {
    if (isLoadingHistory || scrollHeightRef.current === 0) return; // Still loading or not tracking
    
    const containerEl = agentInterfaceRef.current;
    if (!containerEl) return;
    
    const scrollableEl = containerEl.querySelector(".overflow-y-auto") as HTMLElement | null;
    if (!scrollableEl) return;

    // Use requestAnimationFrame to ensure DOM has settled after prepending
    requestAnimationFrame(() => {
      const newHeight = scrollableEl.scrollHeight;
      const heightDelta = newHeight - scrollHeightRef.current;
      if (heightDelta > 0) {
        scrollableEl.scrollTop += heightDelta;
        scrollHeightRef.current = 0;
      }
    });
  }, [isLoadingHistory]);

  const projectName = (cwd: string) =>
    cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;

  return (
    <div className={`pi-de-layout ${activeNode ? "agent-selected" : ""} ${resolvedTheme === "light" ? "pi-de-light" : ""}`}>
      {/* ── LEFT: Roster ─────────────────────────────────── */}
      <div className="sidebar roster-pane">
        <h2>Hyper-Pi Mesh</h2>
        <button className="theme-toggle" onClick={cycleTheme} title="Toggle theme">
          {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️"}
        </button>

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
              <button className="back-button" onClick={() => setActiveNode(null)}>← Back</button>
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

            {isLoadingHistory && (
              <div className="loading-history">
                <div className="spinner" />
                <span>Loading older messages…</span>
              </div>
            )}

            {/* pi-web-ui AgentInterface web component */}
            <div className={`agent-interface-container ${resolvedTheme}`}>
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
