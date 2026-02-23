/**
 * Global setup/teardown for integration tests.
 *
 * Ensures ALL test-spawned pi agents and tmux sessions are cleaned up,
 * even when vitest crashes, times out, or is interrupted (Ctrl+C).
 *
 * Strategy:
 * - Before tests: kill any orphaned hypi-test-* tmux sessions from previous runs
 * - After tests: kill ALL hypi-test-* and hypi-pide tmux sessions
 * - On SIGINT/SIGTERM: same cleanup
 */

import { execSync } from "node:child_process";

/** tmux session prefixes used by our tests */
const TEST_SESSION_PREFIXES = ["hypi-test-", "hypi-pide"];

/**
 * Find and kill all tmux sessions matching our test prefixes.
 * Also kills the pi processes inside them (tmux kill-session sends SIGHUP).
 */
function killTestSessions(): void {
  let sessions: string[];
  try {
    sessions = execSync("tmux list-sessions -F '#{session_name}'", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    // tmux not running or no sessions
    return;
  }

  for (const session of sessions) {
    if (TEST_SESSION_PREFIXES.some((prefix) => session.startsWith(prefix))) {
      try {
        execSync(`tmux kill-session -t '${session}'`, { stdio: "ignore" });
      } catch {
        // already gone
      }
    }
  }
}

/**
 * Kill any orphaned test processes on test ports (40000-60000 range).
 * Covers both pi agents spawned in tmux and hypivisor child processes.
 */
function killOrphanedTestProcesses(): void {
  try {
    const lsofOutput = execSync(
      "lsof -i -sTCP:LISTEN -P -n 2>/dev/null || true",
      { encoding: "utf-8" },
    );
    for (const line of lsofOutput.split("\n")) {
      // Match: <cmd>  <PID>  ...  *:<port> (LISTEN)
      const match = line.match(/^\S+\s+(\d+)\s+.*:(\d+)\s/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);
      const port = parseInt(match[2], 10);
      // Only kill processes in the test port range
      if (port >= 40000 && port < 60000) {
        try {
          const cmdline = execSync(`ps -p ${pid} -o args=`, {
            encoding: "utf-8",
          }).trim();
          // Kill pi agents and hypivisor processes on test ports
          if (
            cmdline === "pi" ||
            cmdline.includes("pi-coding-agent") ||
            cmdline.includes("hypivisor")
          ) {
            process.kill(pid, "SIGTERM");
          }
        } catch {
          // process already gone or permission denied
        }
      }
    }
  } catch {
    // lsof/ps not available or failed — skip
  }
}

function cleanup(): void {
  killTestSessions();
  killOrphanedTestProcesses();
}

let signalHandlersInstalled = false;

export function setup(): void {
  // Kill orphans from previous test runs
  cleanup();

  // Install signal handlers so cleanup runs on Ctrl+C or kill
  if (!signalHandlersInstalled) {
    signalHandlersInstalled = true;
    const handler = () => {
      cleanup();
      process.exit(1);
    };
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    // Also run cleanup when the Node process exits normally
    process.on("exit", () => {
      cleanup();
    });
  }
}

export function teardown(): void {
  cleanup();
}
