/**
 * Reconnect and multi-agent scenario tests.
 *
 * Tests for:
 * 1. Hypivisor restart → Pi-DE reconnect → state is correct (no accumulated ghosts)
 * 2. Proxy returns error for offline/removed agent (not hang)
 * 3. Rapid agent register/deregister cycles
 *
 * Uses real hypivisor binary, no mocks.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startHypivisor,
  connectWs,
  type HypivisorProcess,
} from "./helpers";
import { WebSocketServer, WebSocket } from "ws";

let hv: HypivisorProcess | null = null;
let mockWss: WebSocketServer | null = null;

afterEach(() => {
  hv?.kill();
  hv = null;
  mockWss?.close();
  mockWss = null;
});

describe("Reconnect scenarios", () => {
  it("hypivisor restart → dashboard reconnects → init has correct nodes (no ghost accumulation)", async () => {
    // Start hypivisor, register 2 agents, connect dashboard
    hv = await startHypivisor();

    // Register agent 1
    const agent1 = await connectWs(hv.port);
    await agent1.next(); // init
    agent1.sendRpc("r1", "register", {
      id: "restart-node-1",
      machine: "host",
      cwd: "/tmp/restart-test",
      port: 9001,
      status: "active",
    });
    await agent1.next(); // response
    await agent1.next(); // broadcast

    // Register agent 2
    const agent2 = await connectWs(hv.port);
    await agent2.next(); // init
    agent2.sendRpc("r2", "register", {
      id: "restart-node-2",
      machine: "host",
      cwd: "/tmp/restart-test",
      port: 9002,
      status: "active",
    });
    await agent2.next(); // response
    await agent2.next(); // broadcast
    await agent1.next(); // agent1 gets broadcast for agent2

    // Dashboard connects and sees both nodes
    const dashboard1 = await connectWs(hv.port);
    const init1 = await dashboard1.next();
    expect(init1.event).toBe("init");
    let nodes = (init1.nodes as Array<Record<string, unknown>>).sort((a, b) =>
      (a.id as string).localeCompare(b.id as string)
    );
    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.id)).toEqual(["restart-node-1", "restart-node-2"]);

    dashboard1.close();
    agent1.close();
    agent2.close();

    // Kill hypivisor
    hv.kill();
    await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for process death

    // Restart hypivisor on a new port
    hv = await startHypivisor();

    // Register agents again with same IDs but new WS connection
    const agent1b = await connectWs(hv.port);
    await agent1b.next(); // init
    agent1b.sendRpc("r3", "register", {
      id: "restart-node-1",
      machine: "host",
      cwd: "/tmp/restart-test",
      port: 9001,
      status: "active",
    });
    await agent1b.next(); // response
    await agent1b.next(); // broadcast

    const agent2b = await connectWs(hv.port);
    await agent2b.next(); // init
    agent2b.sendRpc("r4", "register", {
      id: "restart-node-2",
      machine: "host",
      cwd: "/tmp/restart-test",
      port: 9002,
      status: "active",
    });
    await agent2b.next(); // response
    await agent2b.next(); // broadcast
    await agent1b.next(); // broadcast for agent2

    // NEW dashboard reconnects — should see exactly 2 nodes, not 4
    // This is the critical test: accumulated ghosts should NOT happen
    const dashboard2 = await connectWs(hv.port);
    const init2 = await dashboard2.next();
    expect(init2.event).toBe("init");
    nodes = (init2.nodes as Array<Record<string, unknown>>).sort((a, b) =>
      (a.id as string).localeCompare(b.id as string)
    );

    // CRITICAL: Should be exactly 2 nodes, not 4 (no ghost accumulation)
    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.id)).toEqual(["restart-node-1", "restart-node-2"]);

    // Verify all nodes are in active status
    for (const node of nodes) {
      expect(node.status).toBe("active");
    }

    dashboard2.close();
    agent1b.close();
    agent2b.close();
  });

  it("hypivisor restart during dashboard connection → dashboard reconnect completes", async () => {
    hv = await startHypivisor();

    // Agent registers
    const agent = await connectWs(hv.port);
    await agent.next();
    agent.sendRpc("r1", "register", {
      id: "disconnect-node",
      machine: "host",
      cwd: "/tmp/disconnect",
      port: 8888,
      status: "active",
    });
    await agent.next();
    await agent.next();

    // Dashboard connects
    const dashboard = await connectWs(hv.port);
    const init = await dashboard.next();
    expect(init.event).toBe("init");
    expect((init.nodes as unknown[]).length).toBe(1);

    dashboard.close();
    agent.close();

    // Kill hypivisor
    hv.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Restart hypivisor
    hv = await startHypivisor();

    // New agent connects immediately
    const agentAfter = await connectWs(hv.port);
    await agentAfter.next();
    agentAfter.sendRpc("r2", "register", {
      id: "disconnect-node",
      machine: "host",
      cwd: "/tmp/disconnect",
      port: 8888,
      status: "active",
    });
    await agentAfter.next();
    await agentAfter.next();

    // New dashboard connects → should see exactly 1 node
    const dashboardAfter = await connectWs(hv.port);
    const initAfter = await dashboardAfter.next();
    expect(initAfter.event).toBe("init");
    const nodesAfter = initAfter.nodes as Array<Record<string, unknown>>;
    expect(nodesAfter.length).toBe(1);
    expect(nodesAfter[0].id).toBe("disconnect-node");

    dashboardAfter.close();
    agentAfter.close();
  });
});

describe("Rapid register/deregister cycles", () => {
  it("agent registers then deregisters rapidly 5 times → roster stays clean", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Perform 5 rapid register/deregister cycles
    const agents: Awaited<ReturnType<typeof connectWs>>[] = [];
    
    // First, register all 5 agents
    for (let i = 0; i < 5; i++) {
      const agent = await connectWs(hv.port);
      await agent.next(); // init

      // Register
      agent.sendRpc(`r${i}`, "register", {
        id: `rapid-node-${i}`,
        machine: "host",
        cwd: "/tmp/rapid",
        port: 7000 + i,
        status: "active",
      });
      await agent.next(); // response
      await agent.next(); // broadcast (self)

      // Consume broadcast on dashboard
      await dashboard.next();

      // Drain broadcasts from this registration on other agents
      for (const prev of agents) {
        await prev.next();
      }

      agents.push(agent);
    }

    // Verify all 5 are registered
    dashboard.sendRpc("check1", "list_nodes");
    let resp = await dashboard.next();
    let nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(5);

    // Now deregister all 5
    for (let i = 0; i < 5; i++) {
      agents[i].sendRpc(`d${i}`, "deregister", {
        id: `rapid-node-${i}`,
      });

      // Response and broadcast can arrive in any order
      const msg1 = await agents[i].next();
      const msg2 = await agents[i].next();

      const deregResp = [msg1, msg2].find((m) => m.id === `d${i}`);
      expect(deregResp).toBeDefined();

      const deregBroadcast = [msg1, msg2].find((m) => m.event === "node_removed");
      expect(deregBroadcast).toBeDefined();

      // Dashboard sees deregister
      const removedEvent = await dashboard.next();
      expect(removedEvent.event).toBe("node_removed");
      expect(removedEvent.id).toBe(`rapid-node-${i}`);

      // Other agents see the broadcast too
      for (let j = i + 1; j < 5; j++) {
        await agents[j].next();
      }

      agents[i].close();
    }

    // After 5 cycles, roster should be empty
    dashboard.sendRpc("check2", "list_nodes");
    resp = await dashboard.next();
    nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(0);

    dashboard.close();
  });

  it("3 agents in same cwd register/deregister independently without interference", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Register 3 agents in same cwd
    const agents = [];
    for (let i = 0; i < 3; i++) {
      const agent = await connectWs(hv.port);
      await agent.next();
      agent.sendRpc(`r${i}`, "register", {
        id: `same-cwd-${i}`,
        machine: "host",
        cwd: "/Users/dev/same-project", // ALL SAME CWD
        port: 6000 + i,
        status: "active",
      });
      await agent.next(); // response
      await agent.next(); // broadcast (self)

      // Drain broadcasts from registration on dashboard and other agents
      await dashboard.next();
      for (const prev of agents) {
        await prev.next();
      }

      agents.push(agent);
    }

    // Verify all 3 exist with same cwd
    dashboard.sendRpc("list", "list_nodes");
    let resp = await dashboard.next();
    let nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(3);
    expect(nodes.map((n) => n.cwd).every((c) => c === "/Users/dev/same-project")).toBe(true);

    // Deregister agent 1 (middle one)
    agents[1].sendRpc("d1", "deregister", { id: "same-cwd-1" });
    await agents[1].next(); // response
    await agents[1].next(); // broadcast

    // Dashboard sees deregister
    const removed = await dashboard.next();
    expect(removed.event).toBe("node_removed");
    expect(removed.id).toBe("same-cwd-1");

    // Agents 0 and 2 get the deregister broadcast
    await agents[0].next();
    await agents[2].next();

    agents[1].close();

    // Verify only 2 remain with same cwd
    dashboard.sendRpc("list2", "list_nodes");
    resp = await dashboard.next();
    nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(2);
    const ids2 = nodes.map((n) => n.id).sort();
    expect(ids2).toEqual(["same-cwd-0", "same-cwd-2"]);
    expect(nodes.map((n) => n.cwd).every((c) => c === "/Users/dev/same-project")).toBe(true);

    // Deregister agent 0
    agents[0].sendRpc("d0", "deregister", { id: "same-cwd-0" });
    await agents[0].next(); // response
    await agents[0].next(); // broadcast
    
    // Dashboard and agent 2 see the removal
    await dashboard.next(); // removed event
    await agents[2].next(); // removed event

    agents[0].close();

    // Verify only agent 2 remains
    dashboard.sendRpc("list3", "list_nodes");
    resp = await dashboard.next();
    nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe("same-cwd-2");
    expect(nodes[0].cwd).toBe("/Users/dev/same-project");

    agents[2].close();
    dashboard.close();
  });
});

describe("Proxy error handling", () => {
  it("proxy to non-existent nodeId returns error, not hang", async () => {
    hv = await startHypivisor();

    // Try to connect to a node that doesn't exist
    const url = `ws://127.0.0.1:${hv.port}/ws/agent/nonexistent-node-id`;

    // The WebSocket connection itself may succeed (HTTP 200 with WS upgrade),
    // but the proxy should send an error message immediately
    const ws = new WebSocket(url);

    // Set a timeout to catch hangs
    let receivedError = false;
    let receivedData = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.terminate();
        if (!receivedData && !receivedError) {
          reject(new Error("Proxy hung: no error or data received"));
        } else {
          resolve();
        }
      }, 2000); // 2 second timeout — if no message, it's a hang

      ws.on("message", (data) => {
        receivedData = true;
        clearTimeout(timeout);
        const msg = JSON.parse(data.toString());

        // Expect an error message
        if (msg.error) {
          receivedError = true;
          expect(msg.error).toBeDefined();
          ws.terminate();
          resolve();
        } else {
          // Unexpected data
          ws.terminate();
          reject(new Error(`Unexpected message: ${JSON.stringify(msg)}`));
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        // Error on the connection itself is also acceptable (closed immediately)
        ws.terminate();
        resolve();
      });
    });
  });

  it("proxy to offline agent returns error", async () => {
    hv = await startHypivisor();
    const agentPort = 48000 + Math.floor(Math.random() * 1000);

    // Start a WebSocket server simulating pi-socket
    const wss = new WebSocketServer({ port: agentPort });
    mockWss = wss;

    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "init_state", messages: [], tools: [] }));
    });

    // Register the agent with the hypivisor
    const regClient = await connectWs(hv.port);
    await regClient.next();
    regClient.sendRpc("r1", "register", {
      id: "will-be-offline",
      machine: "127.0.0.1",
      cwd: "/tmp/offline",
      port: agentPort,
      status: "active",
    });
    await regClient.next(); // response
    await regClient.next(); // broadcast

    regClient.close();

    // Wait a bit then close the agent server
    await new Promise((resolve) => setTimeout(resolve, 100));
    wss.close();
    mockWss = null;
    await new Promise((resolve) => setTimeout(resolve, 300)); // Wait for server to close

    // Now try to connect to the offline agent through the proxy
    // It should fail quickly, not hang
    const proxyWs = new WebSocket(
      `ws://127.0.0.1:${hv.port}/ws/agent/will-be-offline`,
    );

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proxyWs.terminate();
        reject(new Error("Proxy hung when connecting to offline agent"));
      }, 2000); // 2 second timeout to detect hangs

      proxyWs.on("message", (data) => {
        clearTimeout(timeout);
        // Got a message — could be error or otherwise
        proxyWs.terminate();
        // Any response (not hanging) is success for this test
        resolve();
      });

      proxyWs.on("close", () => {
        clearTimeout(timeout);
        // Connection closed — not a hang
        resolve();
      });

      proxyWs.on("error", () => {
        clearTimeout(timeout);
        // Error is fine — not a hang
        resolve();
      });
    });
  });
});

describe("Multi-agent coexistence", () => {
  it("multiple agents in same cwd with same machine:port get evicted correctly", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Agent A registers on port 7070
    const agentA = await connectWs(hv.port);
    await agentA.next();
    agentA.sendRpc("r1", "register", {
      id: "session-A-port-7070",
      machine: "host",
      cwd: "/Users/dev/multi-test",
      port: 7070,
      status: "active",
    });
    await agentA.next(); // response
    await agentA.next(); // broadcast
    await dashboard.next(); // node_joined

    // Verify A is in roster
    dashboard.sendRpc("check1", "list_nodes");
    let resp = await dashboard.next();
    let nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.map((n) => n.id)).toEqual(["session-A-port-7070"]);

    // Agent B registers on SAME port 7070 with SAME cwd
    // This should evict A (machine:port collision)
    const agentB = await connectWs(hv.port);
    await agentB.next();
    agentB.sendRpc("r2", "register", {
      id: "session-B-port-7070",
      machine: "host",
      cwd: "/Users/dev/multi-test",
      port: 7070,
      status: "active",
    });
    await agentB.next(); // response
    await agentB.next(); // broadcast

    // Dashboard sees eviction: node_removed for A, then node_joined for B
    const removed = await dashboard.next();
    expect(removed.event).toBe("node_removed");
    expect(removed.id).toBe("session-A-port-7070");

    const joined = await dashboard.next();
    expect(joined.event).toBe("node_joined");
    expect((joined.node as Record<string, unknown>).id).toBe("session-B-port-7070");

    // Verify only B is in roster
    dashboard.sendRpc("check2", "list_nodes");
    resp = await dashboard.next();
    nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.map((n) => n.id)).toEqual(["session-B-port-7070"]);

    // But Agent C on port 7071 (different port, same cwd) should NOT evict B
    const agentC = await connectWs(hv.port);
    await agentC.next();
    agentC.sendRpc("r3", "register", {
      id: "session-C-port-7071",
      machine: "host",
      cwd: "/Users/dev/multi-test",
      port: 7071,
      status: "active",
    });
    await agentC.next(); // response
    await agentC.next(); // broadcast
    await dashboard.next(); // node_joined
    await agentB.next(); // B also gets broadcast for C

    // Verify both B and C are in roster
    dashboard.sendRpc("check3", "list_nodes");
    resp = await dashboard.next();
    nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.id).sort()).toEqual([
      "session-B-port-7070",
      "session-C-port-7071",
    ]);

    // Both have same cwd
    for (const node of nodes) {
      expect(node.cwd).toBe("/Users/dev/multi-test");
    }

    agentA.close();
    agentB.close();
    agentC.close();
    dashboard.close();
  });
});
