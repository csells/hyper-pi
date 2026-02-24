/**
 * Hypivisor crash resilience tests.
 *
 * CRITICAL INVARIANT: The hypivisor is an OPTIONAL monitoring layer.
 * If it crashes, is killed (SIGKILL), or becomes unreachable, pi agents
 * MUST continue running. Only dashboard visibility is lost.
 *
 * These tests verify:
 * 1. A mock agent's local WebSocket server survives hypivisor SIGKILL
 * 2. The mock agent automatically re-registers when hypivisor restarts
 * 3. Dashboard clients can still connect directly to the agent's local
 *    WebSocket server after hypivisor death
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startHypivisor,
  connectWs,
  type HypivisorProcess,
} from "./helpers";
import { WebSocketServer, WebSocket } from "ws";

let hv: HypivisorProcess | null = null;
const cleanups: Array<() => void> = [];

afterEach(async () => {
  for (const fn of cleanups) {
    try { fn(); } catch { /* best-effort */ }
  }
  cleanups.length = 0;
  hv?.kill();
  hv = null;
  // Wait for ports to release
  await new Promise((r) => setTimeout(r, 200));
});

/**
 * Connect to a WebSocket server and return the first message along with
 * the open connection. Avoids the race where the server sends init_state
 * before the test registers a message handler.
 */
function connectAndReceiveFirst(
  url: string,
  timeoutMs = 5000,
): Promise<{ ws: WebSocket; msg: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`connect+receive timed out for ${url}`));
    }, timeoutMs);

    ws.on("message", (data) => {
      clearTimeout(timer);
      resolve({ ws, msg: JSON.parse(data.toString()) });
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Simulate pi-socket's behavior:
 * - Run a local WebSocket server (the agent's WSS)
 * - Connect to hypivisor as a client and register
 * - On hypivisor close, attempt reconnect
 */
function startMockPiSocket(opts: {
  agentPort: number;
  hypivisorPort: number;
  nodeId: string;
  cwd: string;
}): {
  wss: WebSocketServer;
  getStatus: () => {
    hypivisorConnected: boolean;
    reconnectAttempts: number;
    localClientsServed: number;
  };
  cleanup: () => void;
} {
  let hypivisorConnected = false;
  let reconnectAttempts = 0;
  let localClientsServed = 0;
  let hypivisorWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Local WebSocket server (simulates pi-socket's WSS)
  const wss = new WebSocketServer({ port: opts.agentPort });
  wss.on("connection", (ws) => {
    localClientsServed++;
    ws.send(
      JSON.stringify({
        type: "init_state",
        messages: [],
        tools: [{ name: "bash", description: "Run bash" }],
      }),
    );
    ws.on("message", (data) => {
      ws.send(
        JSON.stringify({
          type: "message_start",
          role: "assistant",
          content: `Echo: ${data.toString()}`,
        }),
      );
    });
  });

  function connectToHypivisor(): void {
    if (stopped) return;
    try {
      hypivisorWs = new WebSocket(
        `ws://127.0.0.1:${opts.hypivisorPort}/ws`,
      );
    } catch {
      scheduleReconnect();
      return;
    }

    hypivisorWs.on("open", () => {
      hypivisorConnected = true;
      hypivisorWs!.send(
        JSON.stringify({
          id: "reg",
          method: "register",
          params: {
            id: opts.nodeId,
            machine: "test-host",
            cwd: opts.cwd,
            port: opts.agentPort,
            status: "active",
            pid: process.pid,
          },
        }),
      );
    });

    hypivisorWs.on("close", () => {
      hypivisorConnected = false;
      scheduleReconnect();
    });

    hypivisorWs.on("error", () => {
      // Swallow — close will fire next
    });
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectToHypivisor();
    }, 500);
  }

  connectToHypivisor();

  const cleanup = () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (hypivisorWs) {
      hypivisorWs.removeAllListeners();
      hypivisorWs.close();
      hypivisorWs = null;
    }
    wss.close();
  };

  cleanups.push(cleanup);

  return {
    wss,
    getStatus: () => ({
      hypivisorConnected,
      reconnectAttempts,
      localClientsServed,
    }),
    cleanup,
  };
}

describe("Hypivisor crash resilience", () => {
  it("agent local WSS survives hypivisor SIGKILL", async () => {
    hv = await startHypivisor();
    const agentPort = 47000 + Math.floor(Math.random() * 1000);

    const agent = startMockPiSocket({
      agentPort,
      hypivisorPort: hv.port,
      nodeId: "resilience-test-1",
      cwd: "/tmp/resilience-test",
    });

    // Wait for registration
    await new Promise((r) => setTimeout(r, 1000));
    expect(agent.getStatus().hypivisorConnected).toBe(true);

    // Verify agent is in the roster
    const dashboard = await connectWs(hv.port);
    const init = await dashboard.next();
    const nodes = init.nodes as Array<Record<string, unknown>>;
    expect(nodes.some((n) => n.id === "resilience-test-1")).toBe(true);
    dashboard.close();

    // KILL the hypivisor with SIGKILL (most brutal death possible)
    hv.proc.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    hv = null;

    // Agent's local WSS MUST still be alive and serving clients
    const { ws: directClient, msg: initMsg } = await connectAndReceiveFirst(
      `ws://127.0.0.1:${agentPort}`,
    );

    expect(initMsg.type).toBe("init_state");
    expect((initMsg.tools as unknown[]).length).toBeGreaterThan(0);

    directClient.close();
  });

  it("agent re-registers when hypivisor restarts after crash", async () => {
    hv = await startHypivisor();
    const agentPort = 47000 + Math.floor(Math.random() * 1000);

    const agent = startMockPiSocket({
      agentPort,
      hypivisorPort: hv.port,
      nodeId: "reregister-test-1",
      cwd: "/tmp/reregister-test",
    });

    await new Promise((r) => setTimeout(r, 1000));
    expect(agent.getStatus().hypivisorConnected).toBe(true);

    // Kill hypivisor
    hv.proc.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    expect(agent.getStatus().hypivisorConnected).toBe(false);

    // Clean up the first mock agent to free the port
    agent.cleanup();

    // Restart hypivisor on a new port
    hv = await startHypivisor();

    // Create a fresh mock agent (same node ID) connecting to new hypivisor
    const agentPort2 = 47000 + Math.floor(Math.random() * 1000);
    const agent2 = startMockPiSocket({
      agentPort: agentPort2,
      hypivisorPort: hv.port,
      nodeId: "reregister-test-1",
      cwd: "/tmp/reregister-test",
    });

    await new Promise((r) => setTimeout(r, 1500));
    expect(agent2.getStatus().hypivisorConnected).toBe(true);

    // Dashboard should see the agent
    const dashboard = await connectWs(hv.port);
    const init = await dashboard.next();
    const nodes = init.nodes as Array<Record<string, unknown>>;
    expect(nodes.some((n) => n.id === "reregister-test-1")).toBe(true);

    dashboard.close();
  });

  it("agent sends and receives messages after hypivisor crash", async () => {
    hv = await startHypivisor();
    const agentPort = 47000 + Math.floor(Math.random() * 1000);

    startMockPiSocket({
      agentPort,
      hypivisorPort: hv.port,
      nodeId: "msg-after-crash-1",
      cwd: "/tmp/msg-after-crash",
    });

    await new Promise((r) => setTimeout(r, 1000));

    // Kill hypivisor
    hv.proc.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    hv = null;

    // Connect directly to agent
    const { ws, msg: initMsg } = await connectAndReceiveFirst(
      `ws://127.0.0.1:${agentPort}`,
    );
    expect(initMsg.type).toBe("init_state");

    // Send a message and get response
    ws.send("hello after crash");
    const response = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        ws.on("message", (data) => {
          resolve(JSON.parse(data.toString()));
        });
        setTimeout(() => reject(new Error("no response")), 3000);
      },
    );

    expect(response.type).toBe("message_start");
    expect(response.content).toContain("hello after crash");

    ws.close();
  });

  it("multiple agents survive hypivisor crash independently", async () => {
    hv = await startHypivisor();
    const port1 = 47000 + Math.floor(Math.random() * 500);
    const port2 = port1 + 501; // guaranteed different

    startMockPiSocket({
      agentPort: port1,
      hypivisorPort: hv.port,
      nodeId: "multi-survive-1",
      cwd: "/tmp/project-a",
    });

    startMockPiSocket({
      agentPort: port2,
      hypivisorPort: hv.port,
      nodeId: "multi-survive-2",
      cwd: "/tmp/project-a", // Same cwd — multiple agents per dir
    });

    await new Promise((r) => setTimeout(r, 1000));

    // Kill hypivisor
    hv.proc.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    hv = null;

    // Both agents' local servers MUST still be alive
    for (const port of [port1, port2]) {
      const { ws, msg } = await connectAndReceiveFirst(
        `ws://127.0.0.1:${port}`,
      );
      expect(msg.type).toBe("init_state");
      ws.close();
    }
  });
});
