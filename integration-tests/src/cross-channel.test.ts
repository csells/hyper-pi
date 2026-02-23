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
    const tmuxOutput = await waitForTmuxText(agent.sessionName, marker, 45_000);
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
    const tmuxOutput = await waitForTmuxText(agent.sessionName, marker, 45_000);
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
    const tmuxBeforeWeb = await waitForTmuxText(agent.sessionName, tuiMarker, 45_000);
    expect(tmuxBeforeWeb).toContain(tuiMarker);

    // Now send a message from the web client
    const webMarker = `XTEST_WEB_${Math.random().toString(36).slice(2, 8)}`;
    webClient.ws.send(`say exactly: ${webMarker}`);

    // Verify TUI shows the web message
    const tmuxOutput = await waitForTmuxText(agent.sessionName, webMarker, 45_000);
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

    // Send a prompt from the TUI that will take some time to process
    const tuiMarker = `XTEST_STREAM_${Math.random().toString(36).slice(2, 8)}`;
    sendTmuxKeys(agent.sessionName, `say exactly: ${tuiMarker}`);

    // Wait for TUI message to appear (agent is now processing it)
    await waitForTmuxText(agent.sessionName, tuiMarker, 15_000);

    // While the agent is processing the TUI message, send a web follow-up
    // pi-socket will deliver it with { deliverAs: "followUp" }
    const webMarker = `XTEST_FOLLOWUP_${Math.random().toString(36).slice(2, 8)}`;
    const ws = await connectToAgent(agent.nodeId);
    ws.ws.send(`say exactly: ${webMarker}`);

    // Both messages should eventually appear in TUI output
    // The web follow-up is queued and delivered after the current turn
    const tmuxOutput = await waitForTmuxText(agent.sessionName, webMarker, 45_000);
    expect(tmuxOutput).toContain(tuiMarker);
    expect(tmuxOutput).toContain(webMarker);

    ws.close();
  }, 90_000);

  it("Concurrent web clients: web messages appear in TUI for both clients", async () => {
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

    // Client 1 sends a message
    const marker1 = `XTEST_C1_${Math.random().toString(36).slice(2, 8)}`;
    const ws1 = await connectToAgent(agent.nodeId);
    ws1.ws.send(`say exactly: ${marker1}`);

    // Verify TUI shows client 1's message
    const tmuxOutput1 = await waitForTmuxText(agent.sessionName, marker1, 30_000);
    expect(tmuxOutput1).toContain(marker1);

    ws1.close();

    // Wait for the turn to complete
    await sleep(5000);

    // Client 2 sends a different message
    const marker2 = `XTEST_C2_${Math.random().toString(36).slice(2, 8)}`;
    const ws2 = await connectToAgent(agent.nodeId);
    ws2.ws.send(`say exactly: ${marker2}`);

    // Verify TUI shows client 2's message
    const tmuxOutput2 = await waitForTmuxText(agent.sessionName, marker2, 30_000);
    expect(tmuxOutput2).toContain(marker2);

    // TUI should contain both markers
    expect(tmuxOutput2).toContain(marker1);
    expect(tmuxOutput2).toContain(marker2);

    ws2.close();
  }, 90_000);
});
