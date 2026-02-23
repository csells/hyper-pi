/**
 * Helpers for managing real pi agent processes in integration tests.
 *
 * Spawns pi agents in tmux sessions with pi-socket extension loaded,
 * waits for them to register with the hypivisor, and provides cleanup.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const REGISTER_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

export interface PiAgent {
  /** tmux session name */
  sessionName: string;
  /** Node ID as registered with hypivisor */
  nodeId: string;
  /** pi-socket WebSocket port */
  port: number;
  /** Working directory */
  cwd: string;
}

/**
 * Create a temporary directory under /tmp for a test pi agent.
 * Returns the path; caller is responsible for cleanup.
 */
export function createTempCwd(prefix = "hypi-test-"): string {
  // Use realpathSync to resolve macOS /var → /private/var symlink,
  // which matches what pi's process.cwd() reports.
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Clean up a temporary directory.
 */
export function removeTempCwd(cwd: string): void {
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Start a real pi agent in a tmux session with HYPIVISOR_WS pointed
 * at the test hypivisor. Polls the hypivisor until the agent registers.
 */
export async function startPiAgent(opts: {
  cwd: string;
  hypivisorPort: number;
  env?: Record<string, string>;
  sessionSuffix?: string;
}): Promise<PiAgent> {
  const sessionName = `hypi-test-${opts.sessionSuffix ?? Math.random().toString(36).slice(2, 8)}`;

  // Kill existing session if any
  try {
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // session didn't exist
  }

  // Create tmux session
  execSync(`tmux new-session -d -s ${sessionName} -x 200 -y 50`);

  // Build environment variables
  const envVars = [
    `HYPIVISOR_WS=ws://localhost:${opts.hypivisorPort}/ws`,
    // Use a high starting port range to avoid collisions
    `PI_SOCKET_PORT=${40000 + Math.floor(Math.random() * 20000)}`,
    ...(opts.env ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) : []),
  ];

  // Start pi in the tmux session
  const envPrefix = envVars.join(" ");
  execSync(
    `tmux send-keys -t ${sessionName} 'cd ${opts.cwd} && ${envPrefix} pi' Enter`,
  );

  // Get pre-existing node IDs to detect the new one
  const existingNodes = await getRegisteredNodes(opts.hypivisorPort);
  const existingIds = new Set(existingNodes.map((n) => n.id));

  // Poll hypivisor until a new node appears from this agent's cwd
  const startTime = Date.now();
  while (Date.now() - startTime < REGISTER_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const nodes = await getRegisteredNodes(opts.hypivisorPort);
    const newNode = nodes.find(
      (n) =>
        !existingIds.has(n.id as string) &&
        n.status === "active" &&
        (n.cwd as string) === opts.cwd,
    );
    if (newNode) {
      return {
        sessionName,
        nodeId: newNode.id as string,
        port: newNode.port as number,
        cwd: opts.cwd,
      };
    }

  }

  // Timeout — clean up and throw
  killTmuxSession(sessionName);
  throw new Error(
    `Pi agent did not register within ${REGISTER_TIMEOUT_MS}ms. ` +
      `Session: ${sessionName}, cwd: ${opts.cwd}`,
  );
}

/**
 * Stop a pi agent by sending /quit, then kill the tmux session.
 */
export async function stopPiAgent(agent: PiAgent): Promise<void> {
  try {
    // Send /quit command to pi
    execSync(`tmux send-keys -t ${agent.sessionName} '/quit' Enter`);
    // Wait briefly for graceful shutdown
    await sleep(2000);
  } catch {
    // session may already be gone
  }
  killTmuxSession(agent.sessionName);
}

/**
 * Kill a tmux session by name.
 */
export function killTmuxSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // already gone
  }
}

/**
 * Capture tmux pane output.
 */
export function captureTmux(sessionName: string, lines = 100): string {
  try {
    return execSync(`tmux capture-pane -p -t ${sessionName} -S -${lines}`, {
      encoding: "utf-8",
    });
  } catch {
    return "";
  }
}

/**
 * Send keys to a tmux session.
 */
export function sendTmuxKeys(sessionName: string, keys: string): void {
  execSync(`tmux send-keys -t ${sessionName} ${JSON.stringify(keys)} Enter`);
}

/**
 * Query the hypivisor for all registered nodes.
 */
async function getRegisteredNodes(
  port: number,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve([]); // Return empty on timeout (hypivisor may be starting up)
    }, 3000);

    ws.on("open", () => {
      // Wait for init event with node list
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === "init") {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.nodes as Array<Record<string, unknown>>);
      }
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

/**
 * Wait for a specific condition on the hypivisor node list.
 */
export async function waitForNode(
  hypivisorPort: number,
  predicate: (nodes: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 15_000,
): Promise<Array<Record<string, unknown>>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nodes = await getRegisteredNodes(hypivisorPort);
    if (predicate(nodes)) return nodes;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`waitForNode timed out after ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
