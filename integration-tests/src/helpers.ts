/**
 * Shared helpers for cross-component integration tests.
 *
 * Provides functions to:
 * - Start/stop the hypivisor binary on a random port
 * - Connect WebSocket clients with buffered message queues
 * - Send/receive JSON-RPC messages
 */

import { ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import WebSocket from "ws";

const HYPIVISOR_BIN = resolve(
  process.cwd(),
  "../hypivisor/target/release/hypivisor",
);
const STARTUP_TIMEOUT_MS = 5_000;
const MSG_TIMEOUT_MS = 5_000;

/** Strip ANSI escape codes from tracing output */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export interface HypivisorProcess {
  proc: ChildProcess;
  port: number;
  kill: () => void;
}

/**
 * A WebSocket wrapper that buffers incoming messages into a queue,
 * preventing the race condition where messages arrive between
 * consecutive `await nextMessage()` calls.
 */
export class BufferedWs {
  readonly ws: WebSocket;
  private queue: Record<string, unknown>[] = [];
  private waiters: Array<(msg: Record<string, unknown>) => void> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(parsed);
      } else {
        this.queue.push(parsed);
      }
    });
  }

  /** Read the next JSON message, waiting up to MSG_TIMEOUT_MS. */
  next(): Promise<Record<string, unknown>> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the list
        const idx = this.waiters.indexOf(handler);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error("Timed out waiting for WS message"));
      }, MSG_TIMEOUT_MS);

      const handler = (msg: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.waiters.push(handler);
    });
  }

  /**
   * Read messages until one with a matching JSON-RPC `id` is found.
   * Skips any broadcast messages (those without an `id` field) that arrive first.
   */
  async nextRpc(id: string): Promise<Record<string, unknown>> {
    for (;;) {
      const msg = await this.next();
      if (msg.id === id) return msg;
      // Skip broadcasts and other non-matching messages
    }
  }

  /**
   * Drain `count` messages from the queue (e.g., broadcasts after a mutation).
   * If count is omitted, drains all currently-queued messages without waiting.
   */
  async drain(count?: number): Promise<void> {
    if (count !== undefined) {
      for (let i = 0; i < count; i++) {
        await this.next();
      }
    } else {
      // Drain only what's already buffered
      this.queue.length = 0;
    }
  }

  /** Send a JSON-RPC request. */
  sendRpc(id: string, method: string, params?: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ id, method, params }));
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * Start the hypivisor binary on a random port.
 * Waits for "Hypivisor online" in stderr before resolving.
 */
export function startHypivisor(
  token?: string,
): Promise<HypivisorProcess> {
  return new Promise((resolve, reject) => {
    if (!existsSync(HYPIVISOR_BIN)) {
      reject(
        new Error(
          `Hypivisor binary not found at: ${HYPIVISOR_BIN}\ncwd: ${process.cwd()}`,
        ),
      );
      return;
    }

    // Use a random high port to avoid collisions between parallel tests
    const port = 40000 + Math.floor(Math.random() * 20000);
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      RUST_LOG: "hypivisor=info",
      NO_COLOR: "1",
    };
    if (token) {
      env.HYPI_TOKEN = token;
    } else {
      delete env.HYPI_TOKEN;
    }

    const proc = spawn(HYPIVISOR_BIN, ["--port", String(port)], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(
        new Error(
          `Hypivisor did not start within ${STARTUP_TIMEOUT_MS}ms.\nstderr: ${stderr}`,
        ),
      );
    }, STARTUP_TIMEOUT_MS);

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stripAnsi(stderr).includes("Hypivisor online")) {
        clearTimeout(timer);
        resolve({
          proc,
          port,
          kill: () => {
            proc.kill("SIGTERM");
          },
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start hypivisor: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) {
        reject(
          new Error(
            `Hypivisor exited with code ${code}.\nstderr: ${stderr}`,
          ),
        );
      }
    });
  });
}

/**
 * Connect a buffered WebSocket client to the hypivisor.
 */
export function connectWs(
  port: number,
  token?: string,
  path: string = "/ws",
): Promise<BufferedWs> {
  return new Promise((resolve, reject) => {
    const base = `ws://127.0.0.1:${port}${path}`;
    const url = token
      ? `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : base;

    const ws = new WebSocket(url);

    ws.on("open", () => resolve(new BufferedWs(ws)));
    ws.on("error", (err) => reject(err));

    setTimeout(() => {
      ws.terminate();
      reject(new Error("WebSocket connect timed out"));
    }, MSG_TIMEOUT_MS);
  });
}

/**
 * Attempt a raw WebSocket connection (for auth rejection tests).
 * Returns the raw WebSocket — use when you expect connection failure.
 */
export function connectRawWs(
  port: number,
  token?: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = token
      ? `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`
      : `ws://127.0.0.1:${port}/ws`;

    const ws = new WebSocket(url);

    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => reject(err));

    setTimeout(() => {
      ws.terminate();
      reject(new Error("WebSocket connect timed out"));
    }, MSG_TIMEOUT_MS);
  });
}
