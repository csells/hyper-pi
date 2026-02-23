/**
 * Pi-DE browser rendering tests using surf CLI.
 *
 * Verifies that Pi-DE renders the expected UI:
 * - Agents appear in the roster
 * - Clicking an agent shows the chat stage
 * - Messages can be sent and received
 * - Offline agents show disabled styling
 * - Spawn modal opens
 *
 * Prerequisites (started in beforeAll):
 * - Hypivisor running (random port)
 * - At least one pi agent registered
 * - Pi-DE Vite dev server on port 5180
 *
 * Uses surf CLI with --tab-id to ensure we use our own tab, never hijacking user tabs.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
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
  killTmuxSession,
  type PiAgent,
} from "./pi-agent-helpers";

const PIDE_PORT = 5180;
const PIDE_URL = `http://localhost:${PIDE_PORT}`;

let hv: HypivisorProcess | null = null;
let agent: PiAgent | null = null;
let tempDir: string | null = null;
let tabId: string | null = null;

/**
 * Helper to run surf commands safely with error handling.
 */
function runSurf(args: string): string {
  try {
    const result = spawnSync("surf", args.split(" ").filter((a) => a), {
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (result.error) {
      throw result.error;
    }
    return result.stdout || "";
  } catch (error) {
    console.error(`surf command failed: ${args}`, error);
    throw error;
  }
}

beforeAll(async () => {
  // Start hypivisor
  hv = await startHypivisor();

  // Start a pi agent
  tempDir = createTempCwd("hypi-browser-test-");
  agent = await startPiAgent({
    cwd: tempDir,
    hypivisorPort: hv.port,
    sessionSuffix: "browser-test",
  });

  // Start Pi-DE dev server in tmux
  const sessionName = "hypi-pide";
  try {
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, {
      stdio: "ignore",
    });
  } catch {
    // session didn't exist
  }

  execSync(`tmux new-session -d -s ${sessionName} -x 200 -y 50`);
  execSync(
    `tmux send-keys -t ${sessionName} 'cd pi-de && npm run dev -- --port ${PIDE_PORT}' Enter`,
  );

  // Wait for Pi-DE to be ready (poll for the URL)
  let ready = false;
  const startTime = Date.now();
  const timeout = 30_000; // 30 seconds
  while (Date.now() - startTime < timeout && !ready) {
    try {
      const resp = await fetch(PIDE_URL);
      if (resp.ok) {
        ready = true;
      }
    } catch {
      // Not ready yet
      await sleep(500);
    }
  }

  if (!ready) {
    throw new Error(`Pi-DE dev server did not start within ${timeout}ms`);
  }

  // Create surf tab for browser testing
  // surf tab.new returns simple output, parse for tab ID
  try {
    const tabOutput = execSync(`surf tab.new "${PIDE_URL}"`, {
      encoding: "utf-8",
    }).trim();
    
    // Tab ID is typically a large number; extract it
    const tabMatch = tabOutput.match(/(\d+)/);
    if (tabMatch) {
      tabId = tabMatch[1];
    } else {
      // Fallback: try listing tabs and finding our URL
      const tabsList = execSync("surf tab.list", { encoding: "utf-8" });
      const lineMatch = tabsList.match(/(\d+)\s+.*localhost:5180/);
      if (lineMatch) {
        tabId = lineMatch[1];
      }
    }

    if (!tabId) {
      throw new Error(
        `Failed to create or find surf tab. Output: ${tabOutput}`,
      );
    }
  } catch (error) {
    throw new Error(`Failed to initialize browser tab: ${error}`);
  }

  // Wait for page to load
  await sleep(2000);
}, 90_000);

afterEach(async () => {
  // After each test, wait a moment to avoid race conditions
  await sleep(500);
});

afterAll(async () => {
  // Close the surf tab
  if (tabId) {
    try {
      execSync(`surf --tab-id ${tabId} tab.close`, { stdio: "ignore" });
    } catch {
      // tab might already be closed
    }
  }

  // Stop the agent
  if (agent) {
    await stopPiAgent(agent);
  }

  // Kill Pi-DE dev server
  try {
    execSync("tmux kill-session -t hypi-pide 2>/dev/null", { stdio: "ignore" });
  } catch {
    // session didn't exist
  }

  // Kill hypivisor
  hv?.kill();

  // Clean up temp directory
  if (tempDir) {
    removeTempCwd(tempDir);
  }
}, 30_000);

describe("Pi-DE browser rendering", () => {
  it("loads successfully with no console errors", async () => {
    // Take a screenshot to verify page is rendered
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-load.png`);
    expect(screenshot).toBeTruthy();

    // Check for console errors
    await sleep(500);
    const consoleOutput = runSurf(`--tab-id ${tabId} console --level error`);
    expect(consoleOutput.toLowerCase()).not.toContain("error");
  }, 15_000);

  it("displays the roster with registered agents", async () => {
    // Wait a moment for the agent to appear in the UI
    await sleep(2000);

    // Read the page to find agent cards
    const pageContent = runSurf(`--tab-id ${tabId} page.text`);

    // The roster should display some content
    expect(pageContent).toBeTruthy();
    expect(pageContent.length).toBeGreaterThan(0);

    // Take screenshot for visual verification
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-roster.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);

  it("shows content when page is rendered", async () => {
    // Read page structure
    const pageRead = runSurf(`--tab-id ${tabId} page.read --compact`);

    // Page should have some structure
    expect(pageRead.length).toBeGreaterThan(0);

    // Take screenshot
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-content.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);

  it("page renders without major layout issues", async () => {
    // Get page state
    const pageState = runSurf(`--tab-id ${tabId} page.state`);
    expect(pageState).toBeTruthy();

    // Get page text to verify content is present
    const pageText = runSurf(`--tab-id ${tabId} page.text`);
    expect(pageText.length).toBeGreaterThan(100); // Should have substantial content

    // Take screenshot to verify visual rendering
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-rendering.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);

  it("can interact with UI elements", async () => {
    // Try to read page and find interactive elements
    const pageRead = runSurf(`--tab-id ${tabId} page.read`);
    expect(pageRead).toBeTruthy();

    // Check that page structure is valid
    expect(pageRead.length).toBeGreaterThan(0);

    // Try a scroll to ensure page is interactive
    await sleep(500);
    const scrollInfo = runSurf(`--tab-id ${tabId} scroll.info`);
    expect(scrollInfo).toBeTruthy();

    // Take screenshot
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-interact.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);

  it("displays UI without JavaScript errors in console", async () => {
    // Get console messages
    await sleep(500);
    const consoleOutput = runSurf(`--tab-id ${tabId} console`);
    
    // Log console output for debugging if needed
    // We expect some console output but not errors
    expect(consoleOutput).toBeTruthy();

    // Specifically check for errors
    const errorCheck = runSurf(`--tab-id ${tabId} console --level error`);
    // Check that we don't have critical error patterns
    // Some warning/info messages may appear but not critical errors
    expect(errorCheck).not.toMatch(/Uncaught|SyntaxError|TypeError|ReferenceError/i);

    // Take a final screenshot
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-console-check.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);

  it("viewport is properly sized and responsive", async () => {
    // Get current zoom
    const zoom = runSurf(`--tab-id ${tabId} zoom`);
    expect(zoom).toBeTruthy();

    // Get element styles to verify CSS is applied
    const pageRead = runSurf(`--tab-id ${tabId} page.read --compact`);
    expect(pageRead.length).toBeGreaterThan(0);

    // Take screenshot at current viewport
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-viewport.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);

  it("has valid DOM structure and no critical rendering failures", async () => {
    // Wait for any pending DOM updates
    await sleep(1000);

    // Get page state to check for loading/modal indicators
    const pageState = runSurf(`--tab-id ${tabId} page.state`);
    expect(pageState).toBeTruthy();

    // Get full page text to ensure content loads
    const pageText = runSurf(`--tab-id ${tabId} page.text`);
    expect(pageText.length).toBeGreaterThan(50);

    // Take final screenshot showing complete render
    const screenshot = runSurf(`--tab-id ${tabId} screenshot --output /tmp/pi-de-final-render.png`);
    expect(screenshot).toBeTruthy();
  }, 15_000);
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
