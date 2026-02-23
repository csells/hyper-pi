/**
 * Cross-channel message visibility and TUI interaction tests.
 *
 * Tests the cross-channel guarantee: messages sent from the web appear
 * in TUI output, messages sent from TUI appear in web WebSocket events.
 *
 * Uses real pi agents in tmux sessions, sends messages both ways,
 * and verifies they appear on the other channel.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  startHypivisor,
  connectWs,
  type HypivisorProcess,
  type BufferedWs,
} from "./helpers";
import {
  startPiAgent,
  stopPiAgent,
  createTempCwd,
  removeTempCwd,
  captureTmux,
  sendTmuxKeys,
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

/**
 * Connect to an agent through the proxy and skip past init_state.
 */
async function connectToAgent(agentId: string): Promise<BufferedWs> {
  const ws = await connectWs(
    hv!.port,
    undefined,
    `/ws/agent/${encodeURIComponent(agentId)}`,
  );
  const initState = await ws.next();
  expect(initState.type).toBe("init_state");
  return ws;
}

/**
 * Collect events from a WebSocket until a condition is met or timeout.
 */
async function collectEvents(
  ws: BufferedWs,
  until: (events: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 30_000,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const event = await Promise.race([
        ws.next(),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 1000),
        ),
      ]);
      if (event) {
        events.push(event as Record<string, unknown>);
        if (until(events)) return events;
      }
    } catch {
      // timeout on individual message — keep trying
    }
  }
  return events;
}

/**
 * Poll tmux output until text appears or timeout.
 * Returns the captured output that contains the text.
 */
async function waitForTmuxText(
  sessionName: string,
  text: string,
  timeoutMs = 30_000,
  pollIntervalMs = 500,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const output = captureTmux(sessionName, 100);
    if (output.includes(text)) {
      return output;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for text in tmux: "${text}" (timeout: ${timeoutMs}ms)`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Cross-channel message visibility", () => {
  it("Web → TUI visibility: message sent via proxy appears in TUI output", async () => {
    const cwd = createTempCwd("hypi-crossch-web2tui-");
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "web2tui",
    });
    agents.push(agent);

    // Give the agent a moment to fully stabilize
    await sleep(1000);

    // Send a message with a unique marker from the web
    const marker = `XTEST_${Math.random().toString(36).slice(2, 8)}`;
    const ws = await connectToAgent(agent.nodeId);
    ws.ws.send(`say exactly: ${marker}`);

    // Collect events to ensure the message was received
    const events = await collectEvents(ws, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );
    expect(events.length).toBeGreaterThan(0);

    // Now check the TUI — the marker should appear in the output
    const tmuxOutput = await waitForTmuxText(agent.sessionName, marker);
    expect(tmuxOutput).toContain(marker);

    ws.close();
  }, 60_000);

  it("TUI → Web visibility: message typed in TUI appears as WebSocket event", async () => {
    const cwd = createTempCwd("hypi-crossch-tui2web-");
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "tui2web",
    });
    agents.push(agent);

    // Give the agent a moment to fully stabilize
    await sleep(1000);

    // Connect to the agent via proxy
    const ws = await connectToAgent(agent.nodeId);

    // Type a unique message in the TUI
    const marker = `XTEST_${Math.random().toString(36).slice(2, 8)}`;
    sendTmuxKeys(agent.sessionName, `say exactly: ${marker}`);

    // Collect events until we see a user message_start
    const events = await collectEvents(
      ws,
      (evts) =>
        evts.some(
          (e) =>
            e.type === "message_start" &&
            (e.message as Record<string, unknown>)?.role === "user",
        ),
      15_000,
    );

    // Should have received a user message_start
    const userStart = events.find(
      (e) =>
        e.type === "message_start" &&
        (e.message as Record<string, unknown>)?.role === "user",
    );
    expect(userStart).toBeDefined();

    // Verify TUI shows the marker
    const tmuxOutput = await waitForTmuxText(agent.sessionName, marker);
    expect(tmuxOutput).toContain(marker);

    ws.close();
  }, 60_000);

  it("TUI response → Web events: assistant response to TUI prompt appears on WebSocket", async () => {
    const cwd = createTempCwd("hypi-crossch-resp-");
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "resp",
    });
    agents.push(agent);

    // Give the agent a moment to fully stabilize
    await sleep(1000);

    // Connect to the agent via proxy
    const ws = await connectToAgent(agent.nodeId);

    // Type a prompt in the TUI
    sendTmuxKeys(agent.sessionName, "reply with exactly: CROSSCHANNEL_RESPONSE");

    // Collect events until we see an assistant message_end
    const events = await collectEvents(
      ws,
      (evts) =>
        evts.some(
          (e) =>
            e.type === "message_end" &&
            (e.message as Record<string, unknown>)?.role === "assistant",
        ),
      30_000,
    );

    // Verify we got the expected event types
    const types = events.map((e) => e.type);
    expect(types).toContain("message_start"); // assistant message_start
    expect(types).toContain("message_end"); // assistant message_end

    // Should have message_update events (streaming)
    const hasUpdate = events.some((e) => e.type === "message_update");
    expect(hasUpdate).toBe(true);

    ws.close();
  }, 60_000);

  it("Concurrent clients: Web client sees TUI-initiated messages", async () => {
    const cwd = createTempCwd("hypi-crossch-concurrent-");
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "concurrent",
    });
    agents.push(agent);

    // Give the agent a moment to fully stabilize
    await sleep(1000);

    // Connect one web client
    const webClient = await connectToAgent(agent.nodeId);

    // Send a message from the TUI
    const tuiMarker = `XTEST_TUI_${Math.random().toString(36).slice(2, 8)}`;
    sendTmuxKeys(agent.sessionName, `say exactly: ${tuiMarker}`);

    // Web client should receive a user message_start from TUI
    const events = await collectEvents(
      webClient,
      (evts) =>
        evts.some(
          (e) =>
            e.type === "message_start" &&
            (e.message as Record<string, unknown>)?.role === "user",
        ),
      15_000,
    );

    const userStart = events.find(
      (e) =>
        e.type === "message_start" &&
        (e.message as Record<string, unknown>)?.role === "user",
    );
    expect(userStart).toBeDefined();

    // Verify TUI shows the marker
    const tmuxBeforeWeb = await waitForTmuxText(agent.sessionName, tuiMarker);
    expect(tmuxBeforeWeb).toContain(tuiMarker);

    // Now send a message from the web client
    const webMarker = `XTEST_WEB_${Math.random().toString(36).slice(2, 8)}`;
    webClient.ws.send(`say exactly: ${webMarker}`);

    // Verify TUI shows the web message
    const tmuxOutput = await waitForTmuxText(agent.sessionName, webMarker);
    expect(tmuxOutput).toContain(webMarker);

    webClient.close();
  }, 60_000);

  it("Follow-up from web while TUI-initiated turn is streaming", async () => {
    const cwd = createTempCwd("hypi-crossch-followup-");
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "followup",
    });
    agents.push(agent);

    // Give the agent a moment to fully stabilize
    await sleep(1000);

    // Connect web client
    const webClient = await connectToAgent(agent.nodeId);

    // Send a long-running prompt from the TUI
    const tuiMarker = `XTEST_STREAM_${Math.random().toString(36).slice(2, 8)}`;
    sendTmuxKeys(agent.sessionName, `say exactly: ${tuiMarker}`);

    // Wait a bit for the TUI message to be received
    await sleep(2000);

    // While processing, send a follow-up from the web
    const webMarker = `XTEST_FOLLOWUP_${Math.random().toString(36).slice(2, 8)}`;
    webClient.ws.send(`say exactly: ${webMarker}`);

    // Collect events to verify both messages were processed
    let foundTuiMessage = false;
    let foundWebMessage = false;

    const allEvents = await collectEvents(
      webClient,
      (evts) => {
        // Look for both user messages
        foundTuiMessage = evts.some(
          (e) =>
            e.type === "message_start" &&
            (e.message as Record<string, unknown>)?.role === "user",
        );
        foundWebMessage = evts.some(
          (e) =>
            e.type === "message_start" &&
            (e.message as Record<string, unknown>)?.role === "user" &&
            (e.message as Record<string, unknown>)?.role === "user",
        );
        return evts.filter((e) => e.type === "message_start" && (e.message as Record<string, unknown>)?.role === "user").length >= 2;
      },
      30_000,
    );

    expect(allEvents.length).toBeGreaterThan(0);

    // Count user message_start events
    const userMessages = allEvents.filter(
      (e) =>
        e.type === "message_start" &&
        (e.message as Record<string, unknown>)?.role === "user",
    );
    expect(userMessages.length).toBeGreaterThanOrEqual(2);

    // Verify TUI shows both messages
    const tmuxOutput = await waitForTmuxText(agent.sessionName, webMarker, 15_000);
    expect(tmuxOutput).toContain(tuiMarker);
    expect(tmuxOutput).toContain(webMarker);

    webClient.close();
  }, 90_000);

  it("Concurrent web clients: both see messages from TUI and each other", async () => {
    const cwd = createTempCwd("hypi-crossch-multi-web-");
    tempDirs.push(cwd);

    const agent = await startPiAgent({
      cwd,
      hypivisorPort: hv!.port,
      sessionSuffix: "multiwebclient",
    });
    agents.push(agent);

    // Give the agent a moment to fully stabilize
    await sleep(1000);

    // Connect two web clients
    const webClient1 = await connectToAgent(agent.nodeId);
    const webClient2 = await connectToAgent(agent.nodeId);

    // Client 1 sends a message
    const marker1 = `XTEST_C1_${Math.random().toString(36).slice(2, 8)}`;
    webClient1.ws.send(`say exactly: ${marker1}`);

    // Both clients should see a user message_start
    const eventsC1 = await collectEvents(webClient1, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );
    const eventsC2 = await collectEvents(webClient2, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );

    expect(eventsC1.length).toBeGreaterThan(0);
    expect(eventsC2.length).toBeGreaterThan(0);

    // Verify TUI also shows the message
    const tmuxOutput1 = await waitForTmuxText(agent.sessionName, marker1);
    expect(tmuxOutput1).toContain(marker1);

    // Client 2 sends a message
    const marker2 = `XTEST_C2_${Math.random().toString(36).slice(2, 8)}`;
    webClient2.ws.send(`say exactly: ${marker2}`);

    // Both clients should see another user message_start
    const eventsC1b = await collectEvents(webClient1, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );
    const eventsC2b = await collectEvents(webClient2, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );

    expect(eventsC1b.length).toBeGreaterThan(0);
    expect(eventsC2b.length).toBeGreaterThan(0);

    // Send a message from TUI
    const tuiMarker = `XTEST_TUI_${Math.random().toString(36).slice(2, 8)}`;
    sendTmuxKeys(agent.sessionName, `say exactly: ${tuiMarker}`);

    // Both web clients should see a user message_start from TUI
    const eventsTuiC1 = await collectEvents(webClient1, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );
    const eventsTuiC2 = await collectEvents(webClient2, (evts) =>
      evts.some(
        (e) =>
          e.type === "message_start" &&
          (e.message as Record<string, unknown>)?.role === "user",
      ),
      15_000,
    );

    expect(eventsTuiC1.length).toBeGreaterThan(0);
    expect(eventsTuiC2.length).toBeGreaterThan(0);

    // Verify TUI shows the TUI message
    const tmuxOutput2 = await waitForTmuxText(agent.sessionName, tuiMarker);
    expect(tmuxOutput2).toContain(tuiMarker);

    webClient1.close();
    webClient2.close();
  }, 90_000);
});
