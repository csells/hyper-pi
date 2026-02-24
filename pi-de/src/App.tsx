import { useState, useEffect, useRef, useMemo } from "react";
import { useHypivisor } from "./useHypivisor";
import { useAgent } from "./useAgent";
import { useTheme } from "./useTheme";
import SpawnModal from "./SpawnModal";
import { patchMobileKeyboard } from "./patchMobileKeyboard";
import { patchSendDuringStreaming } from "./patchSendDuringStreaming";
import { registerCompactToolRenderers } from "./toolRenderers";
import type { NodeInfo } from "./types";

// Import pi-web-ui components (registers <agent-interface> custom element)
import "@mariozechner/pi-web-ui/app.css";
import "@mariozechner/pi-web-ui";

// Register compact TUI-style tool renderers before any agent-interface renders
registerCompactToolRenderers();

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
  const { themeName, theme, themes, isDark, setTheme } = useTheme();
  const {
    isLoadingHistory,
    hasMoreHistory,
    loadOlderMessages,
    isAgentStreaming,
  } = agent;

  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const agentInterfaceRef = useRef<HTMLElement | null>(null);
  const scrollHeightRef = useRef<number>(0);
  const [sessionName, setSessionName] = useState<string>("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const projectName = (cwd: string) =>
    cwd.split(/[\/\\]/).filter(Boolean).pop() ?? cwd;

  // Group nodes by project name (last path segment of cwd)
  const groupedNodes = useMemo(() => {
    const groups = new Map<string, NodeInfo[]>();
    nodes.forEach((node) => {
      const project = projectName(node.cwd);
      if (!groups.has(project)) {
        groups.set(project, []);
      }
      groups.get(project)!.push(node);
    });
    return groups;
  }, [nodes]);

  const toggleGroup = (groupName: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupName)) {
      newCollapsed.delete(groupName);
    } else {
      newCollapsed.add(groupName);
    }
    setCollapsedGroups(newCollapsed);
  };

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

  // Initialize session name from localStorage, defaulting to project name
  useEffect(() => {
    if (!activeNode) {
      setSessionName("");
      return;
    }
    const storageKey = `pi-de-session-${activeNode.id}`;
    const stored = localStorage.getItem(storageKey);
    const defaultName = projectName(activeNode.cwd);
    setSessionName(stored || defaultName);
  }, [activeNode]);

  // Save session name to localStorage on change
  useEffect(() => {
    if (!activeNode || !sessionName) return;
    localStorage.setItem(`pi-de-session-${activeNode.id}`, sessionName);
  }, [sessionName, activeNode]);

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
    const cleanupMobileKeyboard = patchMobileKeyboard(el);
    
    // Patch send-during-streaming: allow sending while agent streams
    const cleanupSendDuringStreaming = patchSendDuringStreaming(el);
    
    return () => {
      cleanupMobileKeyboard();
      cleanupSendDuringStreaming();
    };

    // Patches enable:
    // 1. Mobile keyboard: Enter = newline on touch, Shift+Enter = send
    // 2. Send during streaming: AgentInterface.sendMessage removes isStreaming gate,
    //    MessageEditor.isStreaming always false (render send button, allow Enter to send)
  }, [agent.remoteAgent, agent.status, activeNode]);

  // Scroll to bottom when agent is selected or new messages arrive
  useEffect(() => {
    if (!activeNode || agent.status !== "connected") return;

    // Use requestAnimationFrame to ensure DOM has settled after init_state or new messages
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        const containerEl = agentInterfaceRef.current;
        if (!containerEl) return;

        const scrollableEl = containerEl.querySelector(".overflow-y-auto") as HTMLElement | null;
        if (scrollableEl) {
          scrollableEl.scrollTop = scrollableEl.scrollHeight;
        }
      });
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [activeNode?.id, agent.status]);

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

  return (
    <div className={`pi-de-layout ${activeNode ? "agent-selected" : ""} ${!isDark ? "pi-de-light" : ""}`}>
      {/* ── LEFT: Roster ─────────────────────────────────── */}
      <div className="sidebar roster-pane">
        <h2>Hyper-Pi Mesh</h2>
        <select
          className="theme-select"
          value={themeName}
          onChange={(e) => setTheme(e.target.value)}
          title="Select theme"
        >
          {themes.map((t) => (
            <option key={t.name} value={t.name}>
              {t.isDark ? "🌙" : "☀️"} {t.displayName}
            </option>
          ))}
        </select>

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
          {[...groupedNodes.entries()].map(([project, projectNodes]) => {
            const isCollapsed = collapsedGroups.has(project);
            return (
              <div key={project} className="project-group">
                <button
                  className="project-header"
                  onClick={() => toggleGroup(project)}
                >
                  <span className={`collapse-icon ${isCollapsed ? "collapsed" : ""}`}>
                    ▼
                  </span>
                  <span className="project-name">{project}</span>
                  <span className="project-count">{projectNodes.length}</span>
                </button>
                {!isCollapsed &&
                  projectNodes.map((node) => (
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
                        <span className={`status-dot ${node.status} ${activeNode?.id === node.id && isAgentStreaming ? "working" : ""}`} />
                      </div>
                      <span className="metadata">
                        {node.machine}:{node.port}
                        {node.pid ? ` • PID: ${node.pid}` : ""}
                      </span>
                      <span className="metadata cwd">{node.cwd}</span>
                    </button>
                  ))}
              </div>
            );
          })}
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
              <div className="header-info">
                <div>
                  <h3>{projectName(activeNode.cwd)}</h3>
                  <input
                    type="text"
                    className="session-name-input"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="Session name"
                  />
                </div>
                <div className="header-meta">
                  {activeNode.machine}:{activeNode.port}
                </div>
              </div>
              <span className={`status-dot ${isAgentStreaming ? "working" : "active"}`} />
              {agent.status !== "connected" && (
                <span className="agent-status">
                  {agent.status === "connecting" && "Connecting…"}
                  {agent.status === "disconnected" &&
                    "Connection lost — reconnecting…"}
                  {agent.status === "offline" && "Agent offline"}
                </span>
              )}
            </div>

            {agent.status === "offline" ? (
              <div className="offline-stage">
                <h2>Agent Offline</h2>
                <p>Last known location: {activeNode.cwd}</p>
                <p>Machine: {activeNode.machine}:{activeNode.port}</p>
              </div>
            ) : (
              <>
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
                <div className={`agent-interface-container ${isDark ? "dark" : "light"}`}>
                  <agent-interface ref={agentInterfaceRef} />
                </div>
              </>
            )}
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
