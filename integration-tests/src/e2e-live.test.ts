/**
 * Live E2E tests against the REAL running infrastructure.
 *
 * NOT standalone — excluded from `npm test` by default.
 * Run explicitly: `npm run test:e2e-live`
 *
 * Prerequisites (must be running before tests):
 *   1. hypivisor on port 31415
 *   2. At least one pi instance with pi-socket extension loaded
 *   3. Pi-DE Vite dev server on port 5180
 *
 * These tests use the real hypivisor, real pi-socket, and real proxy.
 * No mocks, no stubs, no simulations.
 */

import { describe, it, expect } from "vitest";
import WebSocket from "ws";

const HYPIVISOR_PORT = 31415;
const PIDE_PORT = 5180;
const TIMEOUT_MS = 5_000;

/** Connect a WebSocket and return a helper with buffered messages. */
function connectWs(url: string): Promise<{
  ws: WebSocket;
  next: () => Promise<Record<string, unknown>>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: Record<string, unknown>[] = [];
    const waiters: Array<(msg: Record<string, unknown>) => void> = [];

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    });

    ws.on("open", () =>
      resolve({
        ws,
        next: () => {
          const queued = queue.shift();
          if (queued) return Promise.resolve(queued);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.indexOf(handler);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error("Timed out waiting for WS message"));
            }, TIMEOUT_MS);
            const handler = (msg: Record<string, unknown>) => {
              clearTimeout(timer);
              res(msg);
            };
            waiters.push(handler);
          });
        },
        close: () => ws.close(),
      }),
    );

    ws.on("error", (err) => reject(err));
    setTimeout(() => {
      ws.terminate();
      reject(new Error("WebSocket connect timed out"));
    }, TIMEOUT_MS);
  });
}

/** Get nodes from hypivisor via JSON-RPC. */
async function listNodes(): Promise<Array<Record<string, unknown>>> {
  const client = await connectWs(`ws://127.0.0.1:${HYPIVISOR_PORT}/ws`);
  const init = await client.next(); // init broadcast
  const nodes = (init as Record<string, unknown>).nodes as Array<Record<string, unknown>>;
  client.close();
  return nodes;
}

describe("Live E2E: hypivisor", () => {
  it("is running and accepts WebSocket connections", async () => {
    const client = await connectWs(`ws://127.0.0.1:${HYPIVISOR_PORT}/ws`);
    const init = await client.next();
    expect(init.event).toBe("init");
    expect(init.protocol_version).toBe("1");
    client.close();
  });

  it("has at least one registered active agent", async () => {
    const nodes = await listNodes();
    expect(nodes.length).toBeGreaterThan(0);
    const active = nodes.filter((n) => n.status === "active");
    expect(active.length).toBeGreaterThan(0);
    // Every node should have required fields
    for (const node of nodes) {
      expect(node.id).toBeDefined();
      expect(typeof node.id).toBe("string");
      expect(node.machine).toBeDefined();
      expect(node.cwd).toBeDefined();
      expect(typeof node.port).toBe("number");
      expect(["active", "offline"]).toContain(node.status);
    }
  });

  it("has no duplicate node IDs", async () => {
    const nodes = await listNodes();
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Live E2E: agent proxy", () => {
  it("connects through hypivisor proxy and receives init_state", async () => {
    const nodes = await listNodes();
    expect(nodes.length).toBeGreaterThan(0);

    // Connect to the first active agent through the proxy
    const node = nodes.find((n) => n.status === "active")!;
    const proxyUrl = `ws://127.0.0.1:${HYPIVISOR_PORT}/ws/agent/${encodeURIComponent(node.id as string)}`;
    const client = await connectWs(proxyUrl);
    const initState = await client.next();

    // Verify init_state has the new format (messages array, not events)
    expect(initState.type).toBe("init_state");
    expect(Array.isArray(initState.messages)).toBe(true);
    expect(Array.isArray(initState.tools)).toBe(true);

    // Messages should be proper AgentMessage objects (have role field)
    const messages = initState.messages as Array<Record<string, unknown>>;
    for (const msg of messages) {
      expect(msg.role).toBeDefined();
      expect(["user", "assistant", "toolResult"]).toContain(msg.role);
    }

    // Tools should have name and description
    const tools = initState.tools as Array<Record<string, unknown>>;
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
    }

    client.close();
  });

  it("at least one active agent is reachable through proxy with valid init_state", async () => {
    const nodes = await listNodes();
    const active = nodes.filter((n) => n.status === "active");
    expect(active.length).toBeGreaterThan(0);

    let reachable = 0;
    for (const node of active) {
      const proxyUrl = `ws://127.0.0.1:${HYPIVISOR_PORT}/ws/agent/${encodeURIComponent(node.id as string)}`;
      try {
        const client = await connectWs(proxyUrl);
        const initState = await client.next();
        if (initState.type === "init_state" && Array.isArray(initState.messages)) {
          reachable++;
        }
        client.close();
      } catch {
        // Agent unreachable — may have old code or be shutting down
      }
    }

    expect(reachable).toBeGreaterThan(0);
  });
});

describe("Live E2E: Pi-DE dev server", () => {
  it("is running and serves HTML", async () => {
    const resp = await fetch(`http://127.0.0.1:${PIDE_PORT}/`);
    expect(resp.ok).toBe(true);
    const html = await resp.text();
    expect(html).toContain("Pi-DE");
  });
});
