/**
 * Message round-trip integration tests.
 *
 * Tests the full message flow: send a message to a pi agent through
 * the hypivisor proxy WebSocket, verify the agent processes it, and
 * verify response events flow back through the proxy.
 *
 * Uses REAL pi agents (no mocks). Each LLM turn can take 10-30+ seconds.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  type PiAgent,
} from "./pi-agent-helpers";
import WebSocket from "ws";

let hv: HypivisorProcess | null = null;
let agent: PiAgent | null = null;
let tempDir: string | null = null;

beforeAll(async () => {
  hv = await startHypivisor();
  tempDir = createTempCwd("hypi-roundtrip-");
  agent = await startPiAgent({
    cwd: tempDir,
    hypivisorPort: hv.port,
    sessionSuffix: "roundtrip",
  });
}, 45_000);

afterAll(async () => {
  if (agent) await stopPiAgent(agent);
  hv?.kill();
  if (tempDir) removeTempCwd(tempDir);
}, 15_000);

/**
 * Connect a raw WebSocket to the agent through the proxy.
 * Returns a helper that collects all events into an array.
 */
function connectProxy(): Promise<{
  ws: WebSocket;
  events: Array<Record<string, unknown>>;
  waitFor: (
    predicate: (events: Array<Record<string, unknown>>) => boolean,
    timeoutMs?: number,
  ) => Promise<Array<Record<string, unknown>>>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${hv!.port}/ws/agent/${encodeURIComponent(agent!.nodeId)}`;
    const ws = new WebSocket(url);
    const events: Array<Record<string, unknown>> = [];
    const listeners: Array<() => void> = [];

    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      events.push(parsed);
      // Notify any waiters
      for (const fn of listeners.splice(0)) fn();
    });

    ws.on("open", () => {
      resolve({
        ws,
        events,
        waitFor: (predicate, timeoutMs = 60_000) =>
          new Promise((res, rej) => {
            // Check immediately
            if (predicate(events)) return res(events);

            const timer = setTimeout(() => {
              rej(
                new Error(
                  `waitFor timed out after ${timeoutMs}ms. Got ${events.length} events: ${JSON.stringify(events.map((e) => e.type))}`,
                ),
              );
            }, timeoutMs);

            const check = () => {
              if (predicate(events)) {
                clearTimeout(timer);
                res(events);
              } else {
                listeners.push(check);
              }
            };
            listeners.push(check);
          }),
        close: () => ws.close(),
      });
    });

    ws.on("error", (err) => reject(err));
    setTimeout(() => {
      ws.terminate();
      reject(new Error("Proxy connect timed out"));
    }, 10_000);
  });
}

describe("Message round-trip via proxy", () => {
  it("receives init_state on proxy connect", async () => {
    const client = await connectProxy();

    await client.waitFor((evts) =>
      evts.some((e) => e.type === "init_state"),
    );

    const initState = client.events.find((e) => e.type === "init_state");
    expect(initState).toBeDefined();
    expect(Array.isArray(initState!.messages)).toBe(true);
    expect(Array.isArray(initState!.tools)).toBe(true);

    client.close();
  }, 30_000);

  it("send text → agent processes and streams response back", async () => {
    const client = await connectProxy();

    // Wait for init_state first
    await client.waitFor((evts) =>
      evts.some((e) => e.type === "init_state"),
    );

    // Send a simple message
    client.ws.send("reply with just the word PONG");

    // Wait for the full assistant turn
    await client.waitFor((evts) => {
      const hasAssistantEnd = evts.some(
        (e) =>
          e.type === "message_end" &&
          (e.message as Record<string, unknown>)?.role === "assistant",
      );
      return hasAssistantEnd;
    });

    const types = client.events.map((e) => e.type);

    // Should have message lifecycle events
    expect(types).toContain("message_start");
    expect(types).toContain("message_end");

    // Should have streaming updates
    expect(types).toContain("message_update");

    // Verify user message was received
    const userStart = client.events.find(
      (e) =>
        e.type === "message_start" &&
        (e.message as Record<string, unknown>)?.role === "user",
    );
    expect(userStart).toBeDefined();

    // Verify assistant responded
    const assistantEnd = client.events.find(
      (e) =>
        e.type === "message_end" &&
        (e.message as Record<string, unknown>)?.role === "assistant",
    );
    expect(assistantEnd).toBeDefined();

    client.close();
  }, 120_000);

  it("init_state contains history after a conversation turn", async () => {
    // Reconnect — the previous test had a conversation
    const client = await connectProxy();

    await client.waitFor((evts) =>
      evts.some((e) => e.type === "init_state"),
    );

    const initState = client.events.find((e) => e.type === "init_state")!;
    const messages = initState.messages as Array<Record<string, unknown>>;

    // Should have history from the previous test's turn
    expect(messages.length).toBeGreaterThan(0);
    const roles = messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");

    client.close();
  }, 30_000);

  it("multiple proxy clients both receive events", async () => {
    const client1 = await connectProxy();
    const client2 = await connectProxy();

    // Wait for both to get init_state
    await Promise.all([
      client1.waitFor((evts) => evts.some((e) => e.type === "init_state")),
      client2.waitFor((evts) => evts.some((e) => e.type === "init_state")),
    ]);

    // Send from client1
    client1.ws.send("reply with just the word MULTI");

    // Both should receive the full turn
    const [, events2] = await Promise.all([
      client1.waitFor((evts) =>
        evts.some(
          (e) =>
            e.type === "message_end" &&
            (e.message as Record<string, unknown>)?.role === "assistant",
        ),
      ),
      client2.waitFor((evts) =>
        evts.some(
          (e) =>
            e.type === "message_end" &&
            (e.message as Record<string, unknown>)?.role === "assistant",
        ),
      ),
    ]);

    // Client2 should have received events even though client1 sent the message
    const types2 = new Set(events2.map((e) => e.type));
    expect(types2.has("message_start")).toBe(true);
    expect(types2.has("message_end")).toBe(true);

    client1.close();
    client2.close();
  }, 120_000);
});
