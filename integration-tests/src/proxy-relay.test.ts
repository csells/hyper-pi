/**
 * Proxy relay tests: verify bidirectional message forwarding through
 * the hypivisor's /ws/agent/{nodeId} proxy endpoint.
 *
 * Uses a real hypivisor binary + a real WebSocket server (simulating
 * pi-socket's WSS). No mocks for the proxy itself.
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

describe("Proxy relay: dashboard ↔ agent", () => {
  it("forwards text message from dashboard to agent through proxy", async () => {
    hv = await startHypivisor();
    const agentPort = 48000 + Math.floor(Math.random() * 1000);

    // Start a real WebSocket server simulating pi-socket
    const receivedByAgent: string[] = [];
    const wss = new WebSocketServer({ port: agentPort });
    mockWss = wss;

    wss.on("connection", (ws) => {
      // Send init_state like pi-socket does
      ws.send(JSON.stringify({ type: "init_state", messages: [], tools: [] }));
      ws.on("message", (data) => {
        receivedByAgent.push(data.toString());
      });
    });

    // Register the agent with hypivisor
    const regClient = await connectWs(hv.port);
    await regClient.next(); // init
    regClient.sendRpc("r1", "register", {
      id: "relay-test-node",
      machine: "localhost",
      cwd: "/tmp/relay-test",
      port: agentPort,
      status: "active",
    });
    await regClient.next(); // response
    await regClient.next(); // broadcast

    // Connect through the proxy (like Pi-DE does)
    const dashboard = await connectWs(hv.port, undefined, "/ws/agent/relay-test-node");
    const initState = await dashboard.next();
    expect(initState.type).toBe("init_state");

    // Send a text message from dashboard → agent through proxy
    dashboard.ws.send("hello from dashboard");

    // Wait for message to arrive at the agent
    await new Promise<void>((resolve) => {
      const check = () => {
        if (receivedByAgent.length > 0) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    expect(receivedByAgent).toContain("hello from dashboard");

    dashboard.close();
    regClient.close();
  });

  it("forwards events from agent to dashboard through proxy", async () => {
    hv = await startHypivisor();
    const agentPort = 48000 + Math.floor(Math.random() * 1000);

    const wss = new WebSocketServer({ port: agentPort });
    mockWss = wss;

    const agentClients = new Set<WebSocket>();
    wss.on("connection", (ws) => {
      agentClients.add(ws);
      ws.send(JSON.stringify({ type: "init_state", messages: [], tools: [] }));
      ws.on("close", () => agentClients.delete(ws));
    });

    // Register
    const regClient = await connectWs(hv.port);
    await regClient.next();
    regClient.sendRpc("r1", "register", {
      id: "relay-event-node",
      machine: "localhost",
      cwd: "/tmp/relay-event",
      port: agentPort,
      status: "active",
    });
    await regClient.next();
    await regClient.next();

    // Connect dashboard through proxy
    const dashboard = await connectWs(hv.port, undefined, "/ws/agent/relay-event-node");
    await dashboard.next(); // init_state

    // Agent broadcasts an event
    const event = { type: "message_start", message: { role: "user", content: "test" } };
    for (const c of agentClients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(JSON.stringify(event));
      }
    }

    // Dashboard should receive it
    const received = await dashboard.next();
    expect(received.type).toBe("message_start");
    expect((received.message as Record<string, unknown>).content).toBe("test");

    dashboard.close();
    regClient.close();
  });

  it("forwards multiple messages bidirectionally", async () => {
    hv = await startHypivisor();
    const agentPort = 48000 + Math.floor(Math.random() * 1000);

    const receivedByAgent: string[] = [];
    const wss = new WebSocketServer({ port: agentPort });
    mockWss = wss;

    const agentClients = new Set<WebSocket>();
    wss.on("connection", (ws) => {
      agentClients.add(ws);
      ws.send(JSON.stringify({ type: "init_state", messages: [], tools: [] }));
      ws.on("message", (data) => {
        receivedByAgent.push(data.toString());
        // Echo back as a message_start event
        const text = data.toString();
        ws.send(JSON.stringify({ type: "message_start", message: { role: "user", content: text } }));
      });
      ws.on("close", () => agentClients.delete(ws));
    });

    // Register
    const regClient = await connectWs(hv.port);
    await regClient.next();
    regClient.sendRpc("r1", "register", {
      id: "relay-bidi-node",
      machine: "localhost",
      cwd: "/tmp/relay-bidi",
      port: agentPort,
      status: "active",
    });
    await regClient.next();
    await regClient.next();

    // Connect dashboard
    const dashboard = await connectWs(hv.port, undefined, "/ws/agent/relay-bidi-node");
    await dashboard.next(); // init_state

    // Send 3 messages from dashboard
    dashboard.ws.send("msg-1");
    dashboard.ws.send("msg-2");
    dashboard.ws.send("msg-3");

    // Should get 3 echo responses
    const r1 = await dashboard.next();
    const r2 = await dashboard.next();
    const r3 = await dashboard.next();

    expect((r1.message as Record<string, unknown>).content).toBe("msg-1");
    expect((r2.message as Record<string, unknown>).content).toBe("msg-2");
    expect((r3.message as Record<string, unknown>).content).toBe("msg-3");

    expect(receivedByAgent).toEqual(["msg-1", "msg-2", "msg-3"]);

    dashboard.close();
    regClient.close();
  });
});
