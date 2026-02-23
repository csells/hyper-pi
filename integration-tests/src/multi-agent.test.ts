/**
 * R-HV-20b / R-HV-20c: Multiple agents per directory.
 *
 * Multiple pi agents can run simultaneously in the same project folder.
 * Each has a unique session ID and port. The hypivisor MUST NOT evict,
 * deduplicate, or collapse nodes based on cwd. The only valid eviction
 * key is machine:port.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startHypivisor,
  connectWs,
  type HypivisorProcess,
} from "./helpers";

let hv: HypivisorProcess | null = null;

afterEach(() => {
  hv?.kill();
  hv = null;
});

describe("Multiple agents per directory (R-HV-20b, R-HV-20c)", () => {
  it("two agents in the same cwd coexist — neither is evicted", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Agent A registers in /project
    const agentA = await connectWs(hv.port);
    await agentA.next(); // init
    agentA.sendRpc("r1", "register", {
      id: "agent-A",
      machine: "host",
      cwd: "/Users/dev/project",
      port: 8081,
      status: "active",
    });
    await agentA.nextRpc("r1");

    // Agent B registers in the SAME cwd, different port
    const agentB = await connectWs(hv.port);
    await agentB.next(); // init
    agentB.sendRpc("r2", "register", {
      id: "agent-B",
      machine: "host",
      cwd: "/Users/dev/project",
      port: 8082,
      status: "active",
    });
    await agentB.nextRpc("r2");
    await new Promise((r) => setTimeout(r, 50)); // let broadcasts settle

    // Verify both agents exist via list_nodes
    dashboard.sendRpc("ln", "list_nodes");
    const resp = await dashboard.nextRpc("ln");
    const nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(2);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["agent-A", "agent-B"]);

    // Both have the same cwd
    for (const node of nodes) {
      expect(node.cwd).toBe("/Users/dev/project");
    }

    agentA.close();
    agentB.close();
    dashboard.close();
  });

  it("five agents in the same cwd all coexist", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    const agents: Awaited<ReturnType<typeof connectWs>>[] = [];
    for (let i = 0; i < 5; i++) {
      const agent = await connectWs(hv.port);
      await agent.next(); // init
      agent.sendRpc(`r${i}`, "register", {
        id: `agent-${i}`,
        machine: "host",
        cwd: "/Users/dev/same-project",
        port: 9000 + i,
        status: "active",
      });
      await agent.nextRpc(`r${i}`);
      agents.push(agent);
    }

    // Let broadcasts settle
    await new Promise((r) => setTimeout(r, 100));

    // All 5 must be present
    dashboard.sendRpc("ln", "list_nodes");
    const resp = await dashboard.nextRpc("ln");
    const nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(5);

    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["agent-0", "agent-1", "agent-2", "agent-3", "agent-4"]);

    // All same cwd, all different ports
    const ports = new Set(nodes.map((n) => n.port));
    expect(ports.size).toBe(5);
    for (const node of nodes) {
      expect(node.cwd).toBe("/Users/dev/same-project");
    }

    for (const agent of agents) agent.close();
    dashboard.close();
  });

  it("eviction only happens on machine:port, not machine:cwd", async () => {
    hv = await startHypivisor();

    const dashboard = await connectWs(hv.port);
    await dashboard.next(); // init

    // Agent A on port 8081
    const agentA = await connectWs(hv.port);
    await agentA.next();
    agentA.sendRpc("r1", "register", {
      id: "old-session",
      machine: "host",
      cwd: "/Users/dev/project",
      port: 8081,
      status: "active",
    });
    await agentA.nextRpc("r1");
    await new Promise((r) => setTimeout(r, 50));

    // Agent B on SAME port 8081 (simulates process restart reusing port)
    const agentB = await connectWs(hv.port);
    await agentB.next();
    agentB.sendRpc("r2", "register", {
      id: "new-session",
      machine: "host",
      cwd: "/Users/dev/project",
      port: 8081,
      status: "active",
    });
    await agentB.nextRpc("r2");
    await new Promise((r) => setTimeout(r, 50));

    // Only 1 node remains (new-session replaced old-session on same port)
    dashboard.sendRpc("ln", "list_nodes");
    const resp = await dashboard.nextRpc("ln");
    const nodes = resp.result as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe("new-session");

    agentA.close();
    agentB.close();
    dashboard.close();
  });

  it("agent in same cwd but different port does NOT evict existing agent", async () => {
    hv = await startHypivisor();

    // Agent A on port 8081
    const agentA = await connectWs(hv.port);
    await agentA.next();
    agentA.sendRpc("r1", "register", {
      id: "session-A",
      machine: "host",
      cwd: "/Users/dev/project",
      port: 8081,
      status: "active",
    });
    await agentA.nextRpc("r1");

    // Agent B on port 8082, SAME cwd — must NOT evict A
    const agentB = await connectWs(hv.port);
    await agentB.next();
    agentB.sendRpc("r2", "register", {
      id: "session-B",
      machine: "host",
      cwd: "/Users/dev/project",
      port: 8082,
      status: "active",
    });
    await agentB.nextRpc("r2");
    await new Promise((r) => setTimeout(r, 50));

    // Both exist
    const check = await connectWs(hv.port);
    const init = await check.next();
    const nodes = init.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.id).sort()).toEqual(["session-A", "session-B"]);

    agentA.close();
    agentB.close();
    check.close();
  });
});
