import { useState, useEffect, useRef } from "react";
import { useHypivisor } from "./useHypivisor";
import { useAgent } from "./useAgent";
import SpawnModal from "./SpawnModal";
import type { NodeInfo } from "./types";

// Import pi-web-ui components (registers <agent-interface> custom element)
import "@mariozechner/pi-web-ui/app.css";
import "@mariozechner/pi-web-ui";

/**
 * Fix Lit class-field-shadowing on pi-web-ui custom elements.
 *
 * pi-web-ui uses native ES2022 class field declarations (e.g. `session;`)
 * which use [[Define]] semantics in the browser. These overwrite Lit's
 * reactive prototype accessors. Lit dev mode detects this and throws in
 * performUpdate(), preventing the component from rendering.
 *
 * The class fields are set in the constructor (before any callback), so
 * we can't intercept them. Instead, we patch Lit's ReactiveElement base
 * class to handle shadowed properties the same way production Lit does:
 * save the own-property values, delete them to expose the prototype
 * accessors, then restore via the setters.
 */
{
  // Find Lit's ReactiveElement base class from any registered pi-web-ui element
  const AnyLitCtor = customElements.get("agent-interface") as
    | (new () => HTMLElement) & { elementProperties?: Map<string, unknown> }
    | undefined;
  if (AnyLitCtor) {
    // Walk up the prototype chain to find ReactiveElement (has elementProperties)
    let Base = AnyLitCtor;
    while (Base && !Object.getOwnPropertyDescriptor(Base.prototype, "performUpdate")) {
      Base = Object.getPrototypeOf(Base);
    }
    if (Base?.prototype?.performUpdate) {
      const origPerformUpdate = Base.prototype.performUpdate;
      Base.prototype.performUpdate = function (this: HTMLElement) {
        // Before first update, fix shadowed class fields (mirrors Lit production _$E_)
        const ctor = this.constructor as { elementProperties?: Map<string, unknown> };
        if (ctor.elementProperties) {
          const saved = new Map<string, unknown>();
          const obj = this as unknown as Record<string, unknown>;
          for (const prop of ctor.elementProperties.keys()) {
            if (this.hasOwnProperty(prop)) {
              saved.set(prop as string, obj[prop as string]);
              delete obj[prop as string];
            }
          }
          if (saved.size > 0) {
            // Restore through Lit's prototype setters
            for (const [k, v] of saved) {
              obj[k] = v;
            }
          }
        }
        return origPerformUpdate.call(this);
      };
    }
  }
}

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
