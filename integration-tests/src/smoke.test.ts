/**
 * Cross-component smoke tests.
 *
 * These tests start the real hypivisor binary and simulate both
 * a pi-socket agent and a Pi-DE dashboard connecting via WebSocket,
 * verifying the full event flow end-to-end.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startHypivisor,
  connectWs,
  type HypivisorProcess,
  type BufferedWs,
} from "./helpers";

let hv: HypivisorProcess | null = null;

afterEach(() => {
  hv?.kill();
  hv = null;
});

describe("Cross-component integration", () => {
  it("full flow: agent registers → dashboard sees node_joined → agent disconnects → dashboard sees node_offline", async () => {
    hv = await startHypivisor();

    // 1. Dashboard connects and receives empty init
    const dashboard = await connectWs(hv.port);
    const init = await dashboard.next();
    expect(init.event).toBe("init");
    expect(init.protocol_version).toBe("1");
    expect(Array.isArray(init.nodes)).toBe(true);
    expect((init.nodes as unknown[]).length).toBe(0);

    // 2. Agent (simulating pi-socket) connects and registers
    const agent = await connectWs(hv.port);
    const agentInit = await agent.next();
    expect(agentInit.event).toBe("init");

    agent.sendRpc("reg-1", "register", {
      id: "smoke-node",
      machine: "localhost",
      cwd: "/tmp/smoke-test",
      port: 8080,
      status: "active",
    });

    // Agent gets RPC response
    const regResp = await agent.next();
    expect(regResp.id).toBe("reg-1");
    expect((regResp.result as Record<string, unknown>).status).toBe("registered");

    // Agent also gets the node_joined broadcast
    const agentBroadcast = await agent.next();
    expect(agentBroadcast.event).toBe("node_joined");

    // 3. Dashboard receives node_joined broadcast
    const dashboardJoined = await dashboard.next();
    expect(dashboardJoined.event).toBe("node_joined");
    const node = dashboardJoined.node as Record<string, unknown>;
    expect(node.id).toBe("smoke-node");
    expect(node.machine).toBe("localhost");
    expect(node.cwd).toBe("/tmp/smoke-test");
    expect(node.port).toBe(8080);
    expect(node.status).toBe("active");

    // 4. Agent disconnects (simulating network drop)
    agent.close();

    // 5. Dashboard receives node_offline
    const offlineEvent = await dashboard.next();
    expect(offlineEvent.event).toBe("node_offline");
    expect(offlineEvent.id).toBe("smoke-node");

    dashboard.close();
  });

  it("agent deregisters cleanly → dashboard sees node_removed → node gone from roster", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Agent registers
    const agent = await connectWs(hv.port);
    await agent.next(); // init
    agent.sendRpc("reg-1", "register", {
      id: "dereg-node",
      machine: "localhost",
      cwd: "/tmp/dereg-test",
      port: 9000,
      status: "active",
    });
    await agent.next(); // RPC response
    await agent.next(); // node_joined broadcast
    await dashboard.next(); // node_joined

    // Agent deregisters (like pi-socket does on session_shutdown)
    agent.sendRpc("dereg-1", "deregister", { id: "dereg-node" });

    // Agent receives both the RPC response and the node_removed broadcast
    // (order not guaranteed), so collect both and check.
    const msg1 = await agent.next();
    const msg2 = await agent.next();
    const deregResp = [msg1, msg2].find((m) => m.id === "dereg-1")!;
    expect(deregResp).toBeDefined();
    expect((deregResp.result as Record<string, unknown>).status).toBe("deregistered");

    // Dashboard receives node_removed
    const removed = await dashboard.next();
    expect(removed.event).toBe("node_removed");
    expect(removed.id).toBe("dereg-node");

    // Node is gone from roster — late-joining dashboard sees empty init
    const late = await connectWs(hv.port);
    const lateInit = await late.next();
    expect((lateInit.nodes as unknown[]).length).toBe(0);

    agent.close();
    dashboard.close();
    late.close();
  });

  it("late-joining dashboard sees existing nodes in init", async () => {
    hv = await startHypivisor();

    // Agent registers
    const agent = await connectWs(hv.port);
    await agent.next(); // init
    agent.sendRpc("r1", "register", {
      id: "early-node",
      machine: "host",
      cwd: "/tmp/early",
      port: 9001,
      status: "active",
    });
    await agent.next(); // RPC response
    await agent.next(); // node_joined broadcast

    // Dashboard connects after registration
    const dashboard = await connectWs(hv.port);
    const init = await dashboard.next();
    expect(init.event).toBe("init");
    const nodes = init.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe("early-node");
    expect(nodes[0].status).toBe("active");

    agent.close();
    dashboard.close();
  });

  it("dashboard can call list_nodes RPC", async () => {
    hv = await startHypivisor();

    // Register 2 agents
    const agent1 = await connectWs(hv.port);
    await agent1.next();
    agent1.sendRpc("r1", "register", {
      id: "rpc-node-1",
      machine: "h1",
      cwd: "/tmp/a",
      port: 8001,
      status: "active",
    });
    await agent1.next(); // response
    await agent1.next(); // broadcast

    const agent2 = await connectWs(hv.port);
    await agent2.next();
    agent2.sendRpc("r2", "register", {
      id: "rpc-node-2",
      machine: "h2",
      cwd: "/tmp/b",
      port: 8002,
      status: "active",
    });
    await agent2.next(); // response
    await agent2.next(); // broadcast
    // agent1 also gets broadcast for agent2 — consume it
    await agent1.next();

    // Dashboard calls list_nodes
    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    dashboard.sendRpc("ln", "list_nodes");
    const resp = await dashboard.next();
    expect(resp.id).toBe("ln");
    const nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(2);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("rpc-node-1");
    expect(ids).toContain("rpc-node-2");

    agent1.close();
    agent2.close();
    dashboard.close();
  });

  it("re-registration after disconnect restores active status", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Agent registers, then disconnects
    const agent1 = await connectWs(hv.port);
    await agent1.next();
    agent1.sendRpc("r1", "register", {
      id: "reconnect-node",
      machine: "host",
      cwd: "/tmp/reconnect",
      port: 7777,
      status: "active",
    });
    await agent1.next(); // response
    await agent1.next(); // broadcast

    // Dashboard sees node_joined
    const joined1 = await dashboard.next();
    expect(joined1.event).toBe("node_joined");

    // Agent disconnects
    agent1.close();

    // Dashboard sees node_offline
    const offline = await dashboard.next();
    expect(offline.event).toBe("node_offline");
    expect(offline.id).toBe("reconnect-node");

    // Agent reconnects with same ID
    const agent2 = await connectWs(hv.port);
    await agent2.next();
    agent2.sendRpc("r2", "register", {
      id: "reconnect-node",
      machine: "host",
      cwd: "/tmp/reconnect",
      port: 7777,
      status: "active",
    });
    await agent2.next(); // response
    await agent2.next(); // broadcast

    // Dashboard sees node_joined again
    const joined2 = await dashboard.next();
    expect(joined2.event).toBe("node_joined");
    expect((joined2.node as Record<string, unknown>).id).toBe("reconnect-node");
    expect((joined2.node as Record<string, unknown>).status).toBe("active");

    agent2.close();
    dashboard.close();
  });

  it("auth token is enforced when HYPI_TOKEN is set", async () => {
    hv = await startHypivisor("test-secret-42");

    // No token → connection rejected
    await expect(connectWs(hv.port)).rejects.toThrow();

    // Wrong token → rejected
    await expect(connectWs(hv.port, "wrong-token")).rejects.toThrow();

    // Correct token → accepted
    const ws = await connectWs(hv.port, "test-secret-42");
    const init = await ws.next();
    expect(init.event).toBe("init");

    ws.close();
  });

  it("multiple dashboards all receive the same broadcasts", async () => {
    hv = await startHypivisor();

    const d1 = await connectWs(hv.port);
    const d2 = await connectWs(hv.port);
    const d3 = await connectWs(hv.port);
    await d1.next(); // init
    await d2.next(); // init
    await d3.next(); // init

    // Agent registers
    const agent = await connectWs(hv.port);
    await agent.next();
    agent.sendRpc("r1", "register", {
      id: "fanout-node",
      machine: "host",
      cwd: "/tmp/fanout",
      port: 5555,
      status: "active",
    });

    // All 3 dashboards get node_joined
    const e1 = await d1.next();
    const e2 = await d2.next();
    const e3 = await d3.next();

    for (const e of [e1, e2, e3]) {
      expect(e.event).toBe("node_joined");
      expect((e.node as Record<string, unknown>).id).toBe("fanout-node");
    }

    agent.close();
    d1.close();
    d2.close();
    d3.close();
  });

  it("ping RPC returns healthy status", async () => {
    hv = await startHypivisor();

    const ws = await connectWs(hv.port);
    await ws.next(); // init

    ws.sendRpc("p1", "ping");
    const resp = await ws.next();
    expect(resp.id).toBe("p1");
    const result = resp.result as Record<string, unknown>;
    expect(result.status).toBe("healthy");
    expect(result.nodes).toBe(0);

    ws.close();
  });
});
