/**
 * Safety net for pi-socket: catches unanticipated errors at Node event-loop
 * boundaries and logs them to a structured file for later analysis.
 *
 * ## Two-layer error architecture
 *
 * Inner layer: Known errors handled at their source (safeSerialize,
 * readyState guards, hypivisorUrlValid flag, etc.)
 *
 * Outer layer (this module): Catches EVERYTHING ELSE at Node boundaries.
 * If an error reaches this layer, it means the inner layer has a gap.
 * Each log entry is a signal that code needs to be hardened.
 *
 * The log should be empty in a well-functioning system. Every entry
 * represents a bug that should be fixed so it never recurs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LOG_DIR = path.join(os.homedir(), ".pi", "logs");
const LOG_FILE = path.join(LOG_DIR, "pi-socket-errors.jsonl");

interface ErrorEntry {
  /** ISO timestamp */
  ts: string;
  /** Which Node boundary caught this (e.g. "wss.on(connection)") */
  boundary: string;
  /** Error message */
  error: string;
  /** Full stack trace */
  stack: string | undefined;
  /** pi-socket version for correlation */
  version: string;
  /** Node ID of this pi instance */
  nodeId: string;
}

let currentNodeId = "unknown";

export function setNodeId(id: string): void {
  currentNodeId = id;
}

/**
 * Log an unanticipated error to the structured error file.
 * This function MUST NEVER throw.
 */
function logUnexpected(boundary: string, err: unknown): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const entry: ErrorEntry = {
      ts: new Date().toISOString(),
      boundary,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      version: "0.1.0",
      nodeId: currentNodeId,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Cannot write log — nothing left to do. Do NOT throw.
  }
}

/**
 * Wrap a Node event-loop callback with a safety net.
 *
 * Use this at every boundary where code runs outside pi's event system:
 * - wss.on("connection", boundary("wss.connection", handler))
 * - ws.on("message", boundary("ws.message", handler))
 * - setTimeout(boundary("reconnect", fn), ms)
 *
 * Known/expected errors should still be handled inside the callback
 * with specific logic. This wrapper only catches the UNANTICIPATED ones.
 */
export function boundary<A extends unknown[]>(
  name: string,
  fn: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      logUnexpected(name, err);
    }
  };
}

/**
 * Path to the error log file. Exposed for the hardening skill.
 */
export const ERROR_LOG_PATH = LOG_FILE;
