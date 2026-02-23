/**
 * Live pi agent lifecycle integration tests.
 *
 * Spins up REAL pi agents in tmux sessions, verifies they register
 * with a test hypivisor, appear in the roster, and cleanly deregister
 * on shutdown.
 *
 * These tests require: tmux, pi CLI, pi-socket extension installed.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  startHypivisor,
  connectWs,
  type HypivisorProcess,
} from "./helpers";
import {
  startPiAgent,
  stopPiAgent,
  createTempCwd,
  removeTempCwd,
  waitForNode,
  killTmuxSession,
  type PiAgent,
} from "./pi-agent-helpers";

let hv: HypivisorProcess | null = null;
const agents: PiAgent[] = [];
const tempDirs: string[] = [];

beforeAll(async () => {
  hv = await startHypivisor();
}, 15_000);

afterEach(async () => {
  // Clean up any agents started during the test
  for (const agent of agents.splice(0)) {
    await stopPiAgent(agent);
  }
});

afterAll(async () => {
  hv?.kill();
  hv = null;
  // Clean up temp directories
  for (const dir of tempDirs.splice(0)) {
    removeTempCwd(dir);
  }
});

describe("Pi agent lifecycle", () => {
  it("pi agent registers with hypivisor on startup", async () => {
    const cwd = createTempCwd();
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "reg1",
    });
    agents.push(agent);

    // Verify the agent is in the roster
    expect(agent.nodeId).toBeTruthy();
    expect(agent.port).toBeGreaterThan(0);

    // Dashboard should see it
    const dashboard = await connectWs(hv!.port);
    const init = await dashboard.next();
    expect(init.event).toBe("init");
    const nodes = init.nodes as Array<Record<string, unknown>>;
    const found = nodes.find((n) => n.id === agent.nodeId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("active");
    expect(found!.cwd).toBe(cwd);

    dashboard.close();
  }, 45_000);

  it("pi agent deregisters on /quit", async () => {
    const cwd = createTempCwd();
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "dereg1",
    });

    // Verify registered
    const dashboard = await connectWs(hv!.port);
    const init = await dashboard.next();
    const beforeNodes = init.nodes as Array<Record<string, unknown>>;
    expect(beforeNodes.some((n) => n.id === agent.nodeId)).toBe(true);

    // Stop the agent (sends /quit)
    await stopPiAgent(agent);

    // Wait for the node to go offline or be removed
    await waitForNode(
      hv!.port,
      (nodes) => {
        const node = nodes.find((n) => n.id === agent.nodeId);
        return !node || node.status === "offline";
      },
      15_000,
    );

    dashboard.close();
  }, 60_000);

  it("two agents in the same cwd both register", async () => {
    const cwd = createTempCwd();
    tempDirs.push(cwd);

    const agent1 = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "multi1",
    });
    agents.push(agent1);

    const agent2 = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "multi2",
    });
    agents.push(agent2);

    // Both should be registered with different IDs and ports
    expect(agent1.nodeId).not.toBe(agent2.nodeId);
    expect(agent1.port).not.toBe(agent2.port);

    // Dashboard should see both
    const dashboard = await connectWs(hv!.port);
    const init = await dashboard.next();
    const nodes = init.nodes as Array<Record<string, unknown>>;
    const found1 = nodes.find((n) => n.id === agent1.nodeId);
    const found2 = nodes.find((n) => n.id === agent2.nodeId);
    expect(found1).toBeDefined();
    expect(found2).toBeDefined();
    // Both have the same cwd
    expect(found1!.cwd).toBe(cwd);
    expect(found2!.cwd).toBe(cwd);

    dashboard.close();
  }, 60_000);

  it("agent proxy returns init_state for live agent", async () => {
    const cwd = createTempCwd();
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "proxy1",
    });
    agents.push(agent);

    // Connect through the proxy
    const proxyWs = await connectWs(
      hv!.port,
      undefined,
      `/ws/agent/${encodeURIComponent(agent.nodeId)}`,
    );
    const initState = await proxyWs.next();

    expect(initState.type).toBe("init_state");
    expect(Array.isArray(initState.messages)).toBe(true);
    expect(Array.isArray(initState.tools)).toBe(true);

    // Tools should include standard pi tools
    const tools = initState.tools as Array<Record<string, unknown>>;
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map((t) => t.name);
    // pi always has at least 'Bash' and 'Read' tools
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Read");

    proxyWs.close();
  }, 45_000);
});
